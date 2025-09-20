// Embedding index build + query utilities.
// Phase 1: local pseudo-embedding (hash-based) so pipeline works without external model.
// Later we can swap in real providers (Azure OpenAI, etc.) behind the same interface.

import * as vscode from 'vscode';
import * as fs from 'fs';
const fsp = fs.promises;
import * as path from 'path';
import { EmbeddingIndexFile, EmbeddingRecord, SimilarityResult } from './types';
import { getIndex } from '../indexer/index';
import { createEmbedder } from './provider';
import { pseudoEmbedVector } from './pseudo';

const INDEX_VERSION = 2; // bumped due to improved tokenization (camelCase & separator handling)
const DEFAULT_DIMS = 128; // Small to keep perf high; can expand later.
let embedder = createEmbedder();

let inMemory: EmbeddingRecord[] | null = null;
let dims = DEFAULT_DIMS;

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function storageDir(): string | undefined {
  const root = workspaceRoot();
  if (!root) return undefined;
  return path.join(root, '.rhc');
}

function indexFilePath(): string | undefined {
  const dir = storageDir();
  if (!dir) return undefined;
  return path.join(dir, 'embeddings.json');
}

// Very naive hash-based embedding for bootstrap. (Kept for backward compatibility) - now using pseudoEmbedVector directly.
function pseudoEmbed(text: string, dimsLocal = DEFAULT_DIMS): number[] {
  return pseudoEmbedVector(text, dimsLocal);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0; let la = 0; let lb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]; const bv = b[i];
    dot += av * bv; la += av * av; lb += bv * bv;
  }
  return dot / (Math.sqrt(la) * Math.sqrt(lb) || 1);
}

export async function buildEmbeddingIndex(output?: vscode.OutputChannel) {
  const idx = getIndex();
  if (!idx) throw new Error('Base index not built yet. Run RHC: Refresh Index first.');
  embedder = createEmbedder();
  const effectiveDims = embedder.dims || DEFAULT_DIMS;
  const records: EmbeddingRecord[] = [];
  for (const policy of idx.policies) {
    const rtMatch = /PolicyFile_(.+)\.json$/i.exec(policy.file);
    const inferredRT = rtMatch ? rtMatch[1] : undefined;
    const policyText = [policy.file, inferredRT].filter(Boolean).join(' ');
    const [policyVec] = await embedder.embed([policyText]);
    records.push({ id: 'policy:' + policy.file, kind: 'policy', resourceType: inferredRT, text: policyText, vector: policyVec, meta: { file: policy.file } });
  const eventTexts = policy.events.map(ev => [ev.eventId, ev.title, ev.reasonType, inferredRT].filter(Boolean).join(' '));
    const eventVectors = await embedder.embed(eventTexts);
    policy.events.forEach((ev, i) => {
      records.push({ id: 'event:' + policy.file + '#' + (ev.eventId || 'unknown'), kind: 'event', resourceType: inferredRT, text: eventTexts[i], vector: eventVectors[i], meta: { file: policy.file, eventId: ev.eventId, title: ev.title, reasonType: ev.reasonType } });
    });
  }
  // Optional documentation chunks
  const includeDocs = vscode.workspace.getConfiguration().get<boolean>('rhc.index.includeDocs');
  if (includeDocs) {
    const root = workspaceRoot();
    if (root) {
      const docDir = path.join(root, 'documentation');
      try {
        const stat = await fsp.stat(docDir);
        if (stat.isDirectory()) {
          const files = await fsp.readdir(docDir);
            for (const f of files) {
              const full = path.join(docDir, f);
              try {
                const txt = await fsp.readFile(full, 'utf8');
                const chunks = chunkText(txt, 800);
                const vectors = await embedder.embed(chunks);
                chunks.forEach((c, i) => {
                  records.push({ id: 'doc:' + f + '#' + i, kind: 'doc', text: c, vector: vectors[i], meta: { file: f, chunk: i } });
                });
              } catch {}
            }
        }
      } catch {}
    }
  }
  // Persist
  const dir = storageDir();
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = indexFilePath();
  if (file) {
    const payload: EmbeddingIndexFile = { version: INDEX_VERSION, created: new Date().toISOString(), records, dims: effectiveDims };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  }
  inMemory = records;
  dims = effectiveDims;
  output?.appendLine(`[RHC AI] Embedding index built with ${records.length} records (dims=${effectiveDims}).`);
}

export function ensureEmbeddingsLoaded(): boolean {
  if (inMemory) return true;
  const file = indexFilePath();
  if (!file || !fs.existsSync(file)) return false;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed: EmbeddingIndexFile = JSON.parse(raw);
    if (parsed.version !== INDEX_VERSION) return false;
    inMemory = parsed.records;
    dims = parsed.dims;
    return true;
  } catch {
    return false;
  }
}

export function similaritySearch(query: string, limit = 10, filterKind?: string[], resourceTypeHint?: string): SimilarityResult[] {
  if (!inMemory) throw new Error('Embedding index not loaded');
  const qv = pseudoEmbed(query, dims);
  const out: SimilarityResult[] = [];
  for (const r of inMemory) {
    if (filterKind && !filterKind.includes(r.kind)) continue;
    if (resourceTypeHint && r.resourceType && r.resourceType.toLowerCase() !== resourceTypeHint.toLowerCase()) continue;
    const score = cosine(qv, r.vector);
    out.push({ id: r.id, score, meta: r.meta, text: r.text });
  }
  out.sort((a,b) => b.score - a.score);
  return out.slice(0, limit);
}

function chunkText(txt: string, size: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < txt.length) {
    const slice = txt.slice(i, i + size);
    out.push(slice);
    i += size;
  }
  return out;
}
