import * as vscode from 'vscode';
import { getIndex } from '../indexer/index';

/**
 * Simple ad-hoc search UI over in-memory index (substring match on EventId/Title).
 * Chat participant offers richer multi-token + filtering; this remains a quick command palette utility.
 */

export async function searchEvents() {
  const query = await vscode.window.showInputBox({ prompt: 'Search term (matches EventId, Title)', placeHolder: 'e.g. Unavailable' });
  if (!query) return;
  const q = query.toLowerCase();
  const index = getIndex();
  const matches = [] as { policy: string; id: string; title?: string }[];
  for (const p of index.policies) {
    for (const e of p.events) {
      if ((e.eventId && e.eventId.toLowerCase().includes(q)) || (e.title && e.title.toLowerCase().includes(q))) {
        matches.push({ policy: p.file, id: e.eventId, title: e.title });
      }
    }
  }
  const md = `# Event Search: ${query}\n\n${matches.length} match(es)\n\n${matches.map(m => `- ${m.id} (${m.title || ''}) in ${m.policy}`).join('\n') || 'No matches.'}`;
  const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
  vscode.window.showTextDocument(doc);
}