// Entry point for the Resource Health (RHC) Onboarding Assistant VS Code extension.
// This file wires up all commands, initializes the in‑memory index of policy / resource config files,
// registers the tree view, and exposes validation / scaffold features designed to speed onboarding.
//
// Design notes:
// - Index is currently built on demand (no file watcher) to keep the initial scaffold simple.
// - Validation emits coarse (line 0) diagnostics; future enhancement will map JSON paths to ranges.
// - Commands are intentionally small adapters that delegate to focused modules (SRP principle).
// - Output channel 'RHC' centralizes logging to avoid console noise.
import * as vscode from 'vscode';
import { buildIndex, getIndex } from './indexer/index';
import { RHCTreeProvider } from './indexer/treeProvider';
import { validateWorkspace } from './commands/validationTools/validator';
import { scaffoldNewResourceType, scaffoldNonInteractive } from './commands/createOrUpdateTools/scaffold';
import { addEventToPolicy } from './commands/createOrUpdateTools/addEvent';
import { compareResourceConfigs } from './commands/validationTools/compareConfigs';
import { listUnreferencedPolicies } from './commands/validationTools/unreferencedPolicies';
import { searchEvents } from './commands/searchEvents';
import { buildEmbeddingIndex, ensureEmbeddingsLoaded } from './ai/embeddings';
import { detectIntent } from './ai/intent';
import { eventsForResourceType } from './ai/rag';
import { EventSpec } from './commands/createOrUpdateTools/scaffold';

/**npr
 * Extension activation hook.
 * Triggered when a workspace contains RHC artefacts (PolicyFiles / ResourceConfigs) or when a command runs.
 */
export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('RHC');

  /**
   * Rebuilds the in‑memory index of policies & resource configs.
   * Safe to call repeatedly; completely regenerates current snapshot.
   */
  async function refreshIndexCommand() {
    output.appendLine('[RHC] Refreshing index...');
    try {
      await buildIndex(output);
      output.appendLine('[RHC] Index built.');
    } catch (e: any) {
      output.appendLine('[RHC] Index failed: ' + e.message);
    }
  }

  const treeProvider = new RHCTreeProvider();
  vscode.window.registerTreeDataProvider('rhcTree', treeProvider);

  // Register user-facing commands. Each is small and delegates to a module for testability.
  context.subscriptions.push(
    vscode.commands.registerCommand('rhc.index.refresh', refreshIndexCommand),
    vscode.commands.registerCommand('rhc.validate.repository', async () => {
      await refreshIndexCommand();
      treeProvider.refresh();
      await validateWorkspace(output);
    }),
    vscode.commands.registerCommand('rhc.scaffold.newResourceType', async () => {
      await scaffoldNewResourceType(output);
    }),
    vscode.commands.registerCommand('rhc.scaffold.addEvent', async () => {
      await addEventToPolicy(output);
    }),
    vscode.commands.registerCommand('rhc.compare.configs', async () => {
      await compareResourceConfigs(output);
    }),
    vscode.commands.registerCommand('rhc.find.unreferencedPolicies', async () => {
      await listUnreferencedPolicies();
    }),
    vscode.commands.registerCommand('rhc.search.events', async () => {
      await searchEvents();
    }),
    vscode.commands.registerCommand('rhc.ai.rebuildEmbeddings', async () => {
      try {
        await buildIndex(output); // ensure base index
        await buildEmbeddingIndex(output);
        vscode.window.showInformationMessage('RHC AI embedding index rebuilt.');
      } catch (e: any) {
        vscode.window.showErrorMessage('Embedding rebuild failed: ' + e.message);
      }
    })
  );

  // Chat participant: lightweight keyword search over indexed events.
  // This enables @rhc queries in the VS Code Chat / Copilot Chat panel.
  try {
    const chatApi: any = (vscode as any).chat;
    if (chatApi?.createChatParticipant) {
      // Conversation state per session id
      const convoState = new Map<string, { mode: 'scaffold' | null; step: number; resourceType?: string; proposedEvents: EventSpec[] }>();
      const handler: any = async (request: any, _context: any, stream: any, _token: vscode.CancellationToken) => {
        const sessionId = request.session?.id || 'default';
        const state = convoState.get(sessionId);
        const raw = (request.prompt || '').trim();
        // If we are mid scaffolding conversation, intercept first
        if (state?.mode === 'scaffold') {
          if (state.step === 1) { // expecting resource type name
            const name = raw.split(/\s+/)[0];
            state.resourceType = name.includes('.') ? name : `Custom.${name}`;
            // Suggest baseline events (static heuristic for now)
            state.proposedEvents = [
              { eventId: 'ResourceUnavailable', title: 'Resource Unavailable', reasonType: 'Unplanned' },
              { eventId: 'ResourceDegraded', title: 'Resource Degraded', reasonType: 'Unplanned' },
              { eventId: 'ScheduledMaintenance', title: 'Scheduled Maintenance', reasonType: 'Planned' }
            ];
            stream.markdown(`Proposed starter events for **${state.resourceType}**:\n${state.proposedEvents.map(e=>`- ${e.eventId} (${e.reasonType})`).join('\n')}\nReply with a comma-separated list to keep (or provide your own event IDs).`);
            state.step = 2;
            return;
          } else if (state.step === 2) { // expecting event list
            const list = raw.split(/[\n,]/).map((s: string)=>s.trim()).filter(Boolean);
            if (list.length) {
              // Map back to proposed if exists else create shells
              state.proposedEvents = list.map((id: string) => {
                const existing = state.proposedEvents.find(p => p.eventId.toLowerCase() === id.toLowerCase());
                return existing || { eventId: id, title: id, reasonType: 'Unplanned' };
              });
            }
            stream.markdown(`Will scaffold with events:\n${state.proposedEvents.map(e=>`- **${e.eventId}** (${e.reasonType})`).join('\n')}\nType 'yes' to confirm or 'cancel'.`);
            state.step = 3;
            return;
          } else if (state.step === 3) { // confirmation
            const lower = raw.toLowerCase();
            if (lower.startsWith('y')) {
              try {
                await scaffoldNonInteractive(state.resourceType!, output, { events: state.proposedEvents });
                stream.markdown(`Scaffold created for ${state.resourceType}. Run 'RHC: Refresh Index' if tree view doesn't update.`);
              } catch (e: any) {
                stream.markdown('Scaffold failed: ' + e.message);
              }
            } else {
              stream.markdown('Scaffold cancelled.');
            }
            convoState.delete(sessionId);
            return;
          }
        }

        // Ensure index exists (best-effort) for first query.
        if (!getIndex()) {
          try { await buildIndex(output); } catch {}
        }
        const idx = getIndex();
        if (!idx) {
          stream.markdown('Index not ready. Run: RHC: Refresh Index');
          return;
        }
        const lower = raw.toLowerCase();

        // AI Intent Detection (event discovery / future intents)
        try {
          const intent = detectIntent(raw);
          if (intent.intent === 'eventDiscovery') {
            const cfg = vscode.workspace.getConfiguration();
            
            const phraseRaw = intent.resourceTypeQuery || '';
            const phrase = phraseRaw.replace(/^for\s+/i, '').replace(/[^A-Za-z0-9_.\-\s]/g, ' ').trim();
            if (!phrase) {
              stream.markdown('Could not extract resource type phrase. Try: `@rhc what are the possible events for <ResourceType>`');
              return;
            }
            // Ensure embeddings are available
            try {
              if (!ensureEmbeddingsLoaded()) {
                stream.markdown('Building embedding index (first use)...');
                await buildEmbeddingIndex(output);
              }
            } catch (e: any) {
              stream.markdown('Failed to build embeddings: ' + e.message);
              return;
            }
            const limit = cfg.get<number>('rhc.ai.maxContextEvents') || 15;
            try {
              const answer = eventsForResourceType(phrase, limit);
              stream.markdown(answer.markdown);
              if (answer.results.length === 0) {
                stream.markdown('Tip: Rebuild embeddings after adding new policies (`RHC AI: Rebuild Embedding Index`).');
              } else {
                stream.markdown('— Event discovery via pseudo embeddings (experimental).');
              }
            } catch (e: any) {
              stream.markdown('Event discovery failed: ' + e.message);
            }
            return;
          }
        } catch (e: any) {
          // Non-fatal; fall back to basic search path.
          output.appendLine('[RHC] Intent detection error: ' + e.message);
        }

        // Onboarding intent: phrases like "onboard a new resourcetype X" or "create new resource type X"
        const onboardMatch = /(onboard|create|add)\s+(a\s+)?(new\s+)?(resource\s*type|resourcetype)\s+([a-z0-9_.-]+)/i.exec(raw);
        if (onboardMatch) {
          // Start interactive scaffolding if user omitted explicit name? We'll still immediate scaffold for fast path.
          const newNameRaw = onboardMatch[5];
          if (!newNameRaw) {
            convoState.set(sessionId, { mode: 'scaffold', step: 1, proposedEvents: [] });
            stream.markdown('Provide the resource type name (e.g. Contoso.Cache or cacheService).');
            return;
          }
          // Fast path existing behaviour
          const sanitized = newNameRaw.replace(/[^A-Za-z0-9_.-]/g, '');
          stream.markdown(`Onboarding request detected for resource type: **${sanitized}**`);
          const impliedFull = sanitized.includes('.') ? sanitized : `Custom.${sanitized}`;
          try {
            await scaffoldNonInteractive(impliedFull, output);
            stream.markdown(`Scaffold created (or already existed) for ${impliedFull}. Run 'RHC: Refresh Index' if tree doesn't update automatically.`);
          } catch (e: any) {
            stream.markdown(`Failed to scaffold resource: ${e.message}`);
          }
          return;
        }

        // Commands: show <EventId>
        const showMatch = /^show\s+([\w\.\-]+)$/i.exec(lower);
        if (showMatch) {
          const id = showMatch[1];
            for (const p of idx.policies) {
              const ev = p.events.find(e => e.eventId?.toLowerCase() === id);
              if (ev) {
                stream.markdown(`**${ev.eventId}** in \`${p.file}\``);
                if (ev.title) stream.markdown(`Title: ${ev.title}`);
                if (ev.reasonType) stream.markdown(`ReasonType: ${ev.reasonType}`);
                return;
              }
            }
          stream.markdown(`Event '${id}' not found.`);
          return;
        }

        // Parse filters: policy:Name  (case-insensitive, matches file substring)
        let policyFilter: string | undefined;
        const tokens = raw.split(/\s+/);
        const searchTokens: string[] = [];
        for (const t of tokens) {
          const m = /^policy:(.+)$/i.exec(t);
          if (m) { policyFilter = m[1].toLowerCase(); continue; }
          searchTokens.push(t.toLowerCase());
        }
        if (searchTokens.length === 0) { stream.markdown('No search terms after filters.'); return; }

        // Collect candidate events
        const scored: { score: number; id?: string; title?: string; policy: string }[] = [];
        for (const p of idx.policies) {
          if (policyFilter && !p.file.toLowerCase().includes(policyFilter)) continue;
          for (const e of p.events) {
            const hay = ((e.eventId || '') + ' ' + (e.title || '')).toLowerCase();
            let ok = true; let score = 0;
            for (const st of searchTokens) {
              if (!hay.includes(st)) { ok = false; break; }
              score += 1;
            }
            if (ok) scored.push({ score, id: e.eventId, title: e.title, policy: p.file });
          }
        }
        if (scored.length === 0) { stream.markdown(`No events matched '${raw.toLowerCase()}'.`); return; }
        scored.sort((a,b) => b.score - a.score || (a.id||'').localeCompare(b.id||''));
        stream.markdown(`Found ${scored.length} matching event(s):`);
        for (const m of scored.slice(0, 30)) {
          stream.markdown(`• **${m.id}** ${m.title ? '(' + m.title + ') ' : ''}in \`${m.policy}\``);
        }
        if (scored.length > 30) stream.markdown(`… ${scored.length - 30} more not shown (refine your query or add filters like policy:Compute).`);
      };
      const participant = chatApi.createChatParticipant('rhc', handler);
      // Provide follow-up suggestions separately if API surface supports it.
      participant.followupProvider = {
        provideFollowups() {
          return [
            { prompt: 'List unreferenced policies', label: 'Unreferenced Policies' },
            { prompt: 'Search unavailable', label: 'Search Unavailable' },
            { prompt: 'Compare configs', label: 'Compare Configs' }
          ];
        }
      };
      context.subscriptions.push(participant);
    }
  } catch (err: any) {
    output.appendLine('[RHC] Chat participant registration failed (non-fatal): ' + err?.message);
  }

  // Auto-index on activation if workspace likely contains RHC content.
  // Light heuristic: if any policy file path might exist, perform an initial index build.
  const hasPolicy = vscode.workspace.workspaceFolders?.some(f =>
    vscode.workspace.findFiles(new vscode.RelativePattern(f, 'PolicyFiles/PolicyFile_*.json'))
  );
  if (hasPolicy) {
    refreshIndexCommand();
  }
}

// Cleanup hook (currently no long‑lived resources beyond disposables managed in subscriptions).
export function deactivate() {}
