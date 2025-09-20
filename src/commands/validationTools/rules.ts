// Heuristic Validation Rules Module
// ---------------------------------
// Provides lightweight, regex / structure based quality checks that run quickly
// over the in‑memory index. These precede (and will later complement) formal
// JSON schema validation and deeper semantic cross-linking logic.
//
// Philosophy:
//  * Low-noise: prefer fewer, actionable messages over exhaustive but noisy ones
//  * Cheap: no full JSON parsing beyond what the indexer already provided
//  * Extensible: each rule is a concise block; future rules append issues array
//
// Future enhancements (tracked in roadmap):
//  * Severity refinement + enable/disable via user settings
//  * JSON pointer + exact character range mapping per issue
//  * Cross-file duplicate EventId detection across different policies
//  * QuickFix code actions (e.g., stub missing fields)
import * as vscode from 'vscode';
import { RHCIndex } from '../../indexer/index';

export interface ValidationIssue {
  file: string;
  message: string;
  code: string;
  severity: vscode.DiagnosticSeverity;
  line?: number;
}

export function runRules(index: RHCIndex, fileContents: Map<string,string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // Helper to add
  const add = (i: ValidationIssue) => issues.push(i);

  // Build quick lookup of policy events by file
  // Also performs inline duplicate + required field checks.
  const policyEventIds = new Map<string, Set<string>>();
  for (const p of index.policies) {
    const set = new Set<string>();
    for (const e of p.events) {
      if (!e.eventId) continue;
      if (set.has(e.eventId)) {
        add({ file: p.file, message: `Duplicate EventId ${e.eventId}`, code: 'RHC002', severity: vscode.DiagnosticSeverity.Error });
      }
      set.add(e.eventId);
      // RHC001 – required fields
      if (!e.title || !e.reasonType) {
        add({ file: p.file, message: `Event ${e.eventId} missing required field (title or reasonType)`, code: 'RHC001', severity: vscode.DiagnosticSeverity.Error });
      }
      // RHC008 – summary length (approx by retrieving line containing eventId if possible)
    }
    policyEventIds.set(p.file, set);
  }

  // RHC003 – Unreferenced policy file
  // Detects orphan policy files not listed in any resource config (possible dead code).
  const referenced = new Set(index.resourceConfigs.map(r => r.policyFile));
  for (const p of index.policies) {
    if (!referenced.has(p.file)) {
      add({ file: p.file, message: 'Policy file is not referenced by any resource config', code: 'RHC003', severity: vscode.DiagnosticSeverity.Warning });
    }
  }

  // RHC004 – Resource config missing critical linkage fields
  for (const rc of index.resourceConfigs) {
    if (!rc.policyFile || !rc.resourceType) {
      add({ file: rc.file, message: 'Resource config missing PolicyFile or ResourceType', code: 'RHC004', severity: vscode.DiagnosticSeverity.Error });
    }
  }

  // RHC005 – Region / MdmAccounts list empty (likely misconfigured)
  for (const rc of index.resourceConfigs) {
    if (rc.regionCount === 0) {
      add({ file: rc.file, message: 'MdmAccounts list is empty', code: 'RHC005', severity: vscode.DiagnosticSeverity.Warning });
    }
  }

  // RHC009 – Heuristic: Unavailable events should encourage support case creation
  for (const p of index.policies) {
    const content = fileContents.get(p.file);
    if (!content) continue;
    if (content.includes('Unavailable') && !content.includes('<#SupportCase>')) {
      add({ file: p.file, message: 'Unavailable-related events missing SupportCase action token', code: 'RHC009', severity: vscode.DiagnosticSeverity.Information });
    }
  }

  // RHC007 – Empty RecommendedActions arrays reduce actionable guidance
  for (const p of index.policies) {
    const content = fileContents.get(p.file) || '';
    // naive: look for "RecommendedActions": []
    if (/"RecommendedActions"\s*:\s*\[\s*\]/.test(content)) {
      add({ file: p.file, message: 'One or more events have empty RecommendedActions array', code: 'RHC007', severity: vscode.DiagnosticSeverity.Error });
    }
  }

  // RHC006 – Unresolved placeholder tokens (except allowed SupportCase)
  for (const p of index.policies) {
    const content = fileContents.get(p.file) || '';
    const matches = content.match(/<#(?!SupportCase)[^#>]+#>/g);
    if (matches && matches.length) {
      add({ file: p.file, message: `Unresolved placeholder tokens: ${[...new Set(matches)].join(', ')}`, code: 'RHC006', severity: vscode.DiagnosticSeverity.Hint });
    }
  }

  return issues;
}