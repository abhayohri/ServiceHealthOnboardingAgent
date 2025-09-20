import * as vscode from 'vscode';
import { getIndex } from '../../indexer/index';

/**
 * Lists PolicyFiles that have no corresponding ResourceConfig referencing them.
 * Useful for cleanup and detecting forgotten or deprecated policies.
 */

export async function listUnreferencedPolicies() {
  const index = getIndex();
  const referenced = new Set(index.resourceConfigs.map(r => r.policyFile));
  const unref = index.policies.filter(p => !referenced.has(p.file));
  const md = `# Unreferenced Policies (count=${unref.length})\n\n${unref.map(p => `- ${p.file} (${p.events.length} events)`).join('\n') || 'All policies are referenced.'}`;
  const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
  vscode.window.showTextDocument(doc);
}