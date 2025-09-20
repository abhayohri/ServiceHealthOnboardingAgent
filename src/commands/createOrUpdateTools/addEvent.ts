import * as vscode from 'vscode';
import { promises as fs } from 'fs';

/**
 * Interactive command: append a new transient event to a selected policy file.
 * Simplistic JSON modification (no schema validation yet) – relies on user to provide unique EventId.
 * Future: enforce naming conventions, suggest ReasonType options, integrate with conversational flow.
 */

export async function addEventToPolicy(output: vscode.OutputChannel) {
  const policyPick = await pickPolicyFile();
  if (!policyPick) { return; }
  const eventId = await vscode.window.showInputBox({ prompt: 'EventId (unique)' });
  if (!eventId) return;
  const title = await vscode.window.showInputBox({ prompt: 'Title', value: 'Degraded' });
  const summary = await vscode.window.showInputBox({ prompt: 'Summary', value: 'Describe impact and cause.' });
  const fileText = (await fs.readFile(policyPick)).toString();
  const json = JSON.parse(fileText);
  json.TransientEvents = json.TransientEvents || [];
  json.TransientEvents.push({
    EventId: eventId,
    EventName: eventId,
    ReasonType: 'Unplanned',
    Title: title,
    Summary: summary,
    RecommendedActions: [ { Action: 'If persistent, <action>contact support</action>', ActionUrl: '<#SupportCase>' } ]
  });
  await fs.writeFile(policyPick, JSON.stringify(json, null, 2));
  vscode.window.showInformationMessage(`Added event ${eventId}`);
}

/** QuickPick helper to select a PolicyFile_*.json from the repository. */
async function pickPolicyFile(): Promise<string | undefined> {
  const policies = await vscode.workspace.findFiles('src/source/PolicyFiles/PolicyFile_*.json');
  if (!policies.length) { vscode.window.showWarningMessage('No policy files found'); return; }
  const picked = await vscode.window.showQuickPick(policies.map(u => u.fsPath), { placeHolder: 'Select policy file' });
  return picked;
}
