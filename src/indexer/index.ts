// Indexer module
// --------------
// Builds an in‑memory snapshot (RHCIndex) of policy files and resource configuration files.
// Only a minimal subset of fields is extracted to keep indexing cheap and responsive.
// Future enhancements could include:
//  * Region list normalization and cross-env diffing
//  * Caching + incremental updates (currently full rebuild)
//  * Doc ingestion for retrieval / Q&A
//  * Persisting the index to disk for faster reloads
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';
import { parse as parseJsonc, ParseError, printParseErrorCode } from 'jsonc-parser';

/** Lightweight projection of an event used for tree view and search */
export interface RHCEventSummary {
  eventId: string;
  title?: string;
  reasonType?: string;
  policyFile: string;
}

/** A policy file + the events discovered inside it */
export interface PolicyIndexEntry {
  file: string;
  events: RHCEventSummary[];
}

/** A resource config file (environment specific) */
export interface ResourceConfigIndexEntry {
  file: string;
  resourceType?: string;
  policyFile?: string;
  regionCount?: number;
}

/** Root aggregate produced by buildIndex */
export interface RHCIndex {
  policies: PolicyIndexEntry[];
  resourceConfigs: ResourceConfigIndexEntry[];
  timestamp: number;
}

let currentIndex: RHCIndex = { policies: [], resourceConfigs: [], timestamp: Date.now() };

export function getIndex(): RHCIndex { return currentIndex; }

/**
 * Scans the workspace folders looking for PolicyFiles and ResourceConfigs.
 * This is a full rebuild (idempotent); callers simply replace the global snapshot.
 */
export async function buildIndex(output: vscode.OutputChannel) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return; }
  const policies: PolicyIndexEntry[] = [];
  const resourceConfigs: ResourceConfigIndexEntry[] = [];

  for (const folder of folders) {
  // ---- Policy Files ----
  const policyGlob = new vscode.RelativePattern(folder, 'src/source/PolicyFiles/PolicyFile_*.json');
    const policyFiles = await vscode.workspace.findFiles(policyGlob);
    for (const uri of policyFiles) {
      const fileName = path.basename(uri.fsPath);
      try {
        let buf = await fs.readFile(uri.fsPath);
        // Detect UTF-16 LE/BE BOM and re-decode; otherwise assume UTF-8.
        let text: string;
        if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
          text = Buffer.from(buf).toString('utf16le');
        } else if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
          // Node doesn't directly decode BE; naive fallback: swap bytes
          const swapped = Buffer.alloc(buf.length - 2);
          for (let i = 2; i < buf.length; i += 2) {
            swapped[i - 2] = buf[i + 1];
            if (i + 1 < buf.length) swapped[i - 1] = buf[i];
          }
          text = swapped.toString('utf16le');
        } else {
          text = buf.toString('utf8');
        }
        const errors: ParseError[] = [];
        // Tolerant parse allows comments & trailing commas; collect errors instead of throwing.
        const json: any = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
        if (errors.length) {
          // If the very first error is at offset 0, log leading bytes & heuristic.
          if (errors[0].offset === 0) {
            const hexPrefix = [...Buffer.from(text).slice(0,16)].map(b=>b.toString(16).padStart(2,'0')).join(' ');
            const nulCount = [...Buffer.from(text).slice(0,64)].filter(b=>b===0x00).length;
            let hint = '';
            if (nulCount > 10 && !text.startsWith('{') && !text.startsWith('[')) {
              hint = ' (suspicious high NUL count; possible UTF-16 without BOM)';
            } else if (hexPrefix.startsWith('7b 00')) {
              hint = ' (looks like UTF-16 LE without BOM; convert to UTF-8)';
            }
            output.appendLine(`[RHC][Index][Info] Policy ${uri.fsPath} first-bytes: ${hexPrefix}${hint}`);
          }
          const threshold = 25;
          if (errors.length > threshold) {
            const firstFew = errors.slice(0, 10).map(e => {
              const upto = text.slice(0, e.offset);
              const line = upto.split(/\r?\n/).length;
              const col = upto.length - upto.lastIndexOf('\n');
              return `${printParseErrorCode(e.error)}@${line}:${col}`;
            }).join(', ');
            output.appendLine(`[RHC][Index][Warn] Policy ${uri.fsPath} anomalies: ${errors.length} issues (showing first 10): ${firstFew}`);
          } else {
            const annotated = errors.map(e => {
              const upto = text.slice(0, e.offset);
              const line = upto.split(/\r?\n/).length; // 1-based
              const col = upto.length - upto.lastIndexOf('\n');
              return `${printParseErrorCode(e.error)}@${line}:${col}`;
            }).join(', ');
            output.appendLine(`[RHC][Index][Warn] Policy ${uri.fsPath} anomalies: ${annotated}`);
          }
        }
        const events: RHCEventSummary[] = [];
        const collect = (arr: any[]) => {
          if (!Array.isArray(arr)) return;
          for (const e of arr) {
            if (e && typeof e === 'object') {
              events.push({ eventId: e.EventId, title: e.Title, reasonType: e.ReasonType, policyFile: fileName });
            }
          }
        };
        if (json) {
          collect(json.PersistentEvents || []);
          collect(json.TransientEvents || []);
        }
        policies.push({ file: fileName, events });
      } catch (err: any) {
        // Hard failure (likely binary or severely malformed) – index as empty to avoid total loss.
        output.appendLine(`[RHC][Index][Error] Policy ${uri.fsPath} unreadable: ${err.message}`);
        policies.push({ file: fileName, events: [] });
      }
    }

  // ---- Resource Config Files ----
  const rcGlob = new vscode.RelativePattern(folder, 'src/source/ResourceConfigs/**/ResourceConfig_*.json');
    const rcFiles = await vscode.workspace.findFiles(rcGlob);
    for (const uri of rcFiles) {
      const rel = path.relative(folder.uri.fsPath, uri.fsPath);
      try {
        let buf = await fs.readFile(uri.fsPath);
        let text: string;
        if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
          text = Buffer.from(buf).toString('utf16le');
        } else if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
          const swapped = Buffer.alloc(buf.length - 2);
          for (let i = 2; i < buf.length; i += 2) {
            swapped[i - 2] = buf[i + 1];
            if (i + 1 < buf.length) swapped[i - 1] = buf[i];
          }
          text = swapped.toString('utf16le');
        } else {
          text = buf.toString('utf8');
        }
        const errors: ParseError[] = [];
        const json: any = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
        if (errors.length) {
          if (errors[0].offset === 0) {
            const hexPrefix = [...Buffer.from(text).slice(0,16)].map(b=>b.toString(16).padStart(2,'0')).join(' ');
            const nulCount = [...Buffer.from(text).slice(0,64)].filter(b=>b===0x00).length;
            let hint = '';
            if (nulCount > 10 && !text.startsWith('{') && !text.startsWith('[')) {
              hint = ' (suspicious high NUL count; possible UTF-16 without BOM)';
            } else if (hexPrefix.startsWith('7b 00')) {
              hint = ' (looks like UTF-16 LE without BOM; convert to UTF-8)';
            }
            output.appendLine(`[RHC][Index][Info] ResourceConfig ${uri.fsPath} first-bytes: ${hexPrefix}${hint}`);
          }
          const threshold = 25;
          if (errors.length > threshold) {
            const firstFew = errors.slice(0, 10).map(e => {
              const upto = text.slice(0, e.offset);
              const line = upto.split(/\r?\n/).length;
              const col = upto.length - upto.lastIndexOf('\n');
              return `${printParseErrorCode(e.error)}@${line}:${col}`;
            }).join(', ');
            output.appendLine(`[RHC][Index][Warn] ResourceConfig ${uri.fsPath} anomalies: ${errors.length} issues (showing first 10): ${firstFew}`);
          } else {
            const annotated = errors.map(e => {
              const upto = text.slice(0, e.offset);
              const line = upto.split(/\r?\n/).length;
              const col = upto.length - upto.lastIndexOf('\n');
              return `${printParseErrorCode(e.error)}@${line}:${col}`;
            }).join(', ');
            output.appendLine(`[RHC][Index][Warn] ResourceConfig ${uri.fsPath} anomalies: ${annotated}`);
          }
        }
        let regionCount: number | undefined;
        if (json && Array.isArray(json.MdmAccounts)) { regionCount = json.MdmAccounts.length; }
        resourceConfigs.push({ file: rel, resourceType: json?.ResourceType, policyFile: json?.PolicyFile, regionCount });
      } catch (err: any) {
        output.appendLine(`[RHC][Index][Error] ResourceConfig ${uri.fsPath} unreadable: ${err.message}`);
        resourceConfigs.push({ file: rel });
      }
    }
  }
  // Overwrite global snapshot atomically.
  currentIndex = { policies, resourceConfigs, timestamp: Date.now() };
}
