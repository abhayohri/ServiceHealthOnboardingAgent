import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Produces a markdown report grouping ResourceConfigs by their referenced PolicyFile.
 * Highlights environment coverage and basic meta (region count via MdmAccounts length, health system type).
 * Future enhancements: diff parameter overlaps, highlight missing environments, surface ownership discrepancies.
 */

export async function compareResourceConfigs(output: vscode.OutputChannel) {
  const resourceType = await vscode.window.showInputBox({ prompt: 'ResourceType filter (optional contains match)' });
  const rcFiles = await vscode.workspace.findFiles('src/source/ResourceConfigs/**/ResourceConfig_*.json');
  const filtered = [] as { uri: vscode.Uri, json: any }[];
  for (const uri of rcFiles) {
    try {
      const text = (await fs.readFile(uri.fsPath)).toString();
      const json = JSON.parse(text);
      if (!resourceType || (json.ResourceType || '').includes(resourceType)) {
        filtered.push({ uri, json });
      }
    } catch {}
  }
  const groupByPolicy = new Map<string, { uri: vscode.Uri, json: any }[]>();
  for (const item of filtered) {
    const key = item.json.PolicyFile || 'UNKNOWN';
    groupByPolicy.set(key, [...(groupByPolicy.get(key) || []), item]);
  }
  let report = '# Resource Config Comparison\n';
  for (const [policy, items] of groupByPolicy.entries()) {
    report += `\n## ${policy}\n`;
    for (const { uri, json } of items) {
      const env = path.basename(path.dirname(uri.fsPath));
      const regions = Array.isArray(json.MdmAccounts) ? json.MdmAccounts.length : 0;
      report += `- ${env}: regions=${regions} healthType=${json.HealthSystemResourceType}\n`;
    }
  }
  const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
  vscode.window.showTextDocument(doc);
}
