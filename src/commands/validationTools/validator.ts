// Validation Orchestrator
// -----------------------
// Coordinates execution of heuristic rules over the in‑memory index. Currently:
//  * Loads file contents for policy files (needed for certain regex-based checks)
//  * Invokes runRules() to produce high-level ValidationIssue objects
//  * Translates issues into VS Code diagnostics (coarse range at line 0)
// Future enhancements:
//  * Integrate JSON schema validation (AJV) for structural errors
//  * Map diagnostics to exact property/value spans via jsonc-parser AST
//  * Incremental validation on document save instead of full pass
import * as vscode from 'vscode';
import { getIndex } from '../../indexer/index';
import { runRules } from './rules';

/** Executes validation across the workspace and publishes diagnostics. */
export async function validateWorkspace(output: vscode.OutputChannel) {
  const diagnostics = vscode.languages.createDiagnosticCollection('rhc');
  const index = getIndex();
  const fileContents = new Map<string,string>();
  // Preload contents for all policy files (by filename) and resource configs (by relative path)
  const folders = vscode.workspace.workspaceFolders || [];
  for (const folder of folders) {
    for (const p of index.policies) {
      const uri = await findPolicyUri(p.file, folder);
      if (uri) {
        try { fileContents.set(p.file, (await vscode.workspace.fs.readFile(uri)).toString()); } catch {}
      }
    }
  }
  const issues = runRules(index, fileContents);
  const grouped = new Map<string, vscode.Diagnostic[]>();
  for (const issue of issues) {
    const uri = await findAnyUri(issue.file);
    if (!uri) continue;
    const range = new vscode.Range(0,0,0,1);
    const diag = new vscode.Diagnostic(range, `${issue.code}: ${issue.message}`, issue.severity);
    diag.code = issue.code;
    grouped.set(uri.fsPath, [...(grouped.get(uri.fsPath) || []), diag]);
  }
  for (const [fsPath, diags] of grouped) {
    diagnostics.set(vscode.Uri.file(fsPath), diags);
  }
  output.appendLine(`[RHC][Validate] ${issues.length} issues reported`);
}

/** Locate a policy file by name within the workspace (returns first match). */
async function findPolicyUri(fileName: string, folder?: vscode.WorkspaceFolder): Promise<vscode.Uri | undefined> {
  const folders = folder ? [folder] : (vscode.workspace.workspaceFolders || []);
  for (const f of folders) {
    const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(f, `PolicyFiles/${fileName}`), undefined, 1);
    if (matches.length) return matches[0];
  }
  return undefined;
}

/** Resolve either a policy file OR a resource config by filename / relative path. */
async function findAnyUri(fileName: string): Promise<vscode.Uri | undefined> {
  // Try policy first
  const pol = await findPolicyUri(fileName);
  if (pol) return pol;
  // Try resource config relative path search
  const folders = vscode.workspace.workspaceFolders || [];
  for (const f of folders) {
    const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(f, `ResourceConfigs/**/${fileName}`), undefined, 1);
    if (matches.length) return matches[0];
  }
  return undefined;
}
