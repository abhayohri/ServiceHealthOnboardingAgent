import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';

/**
 * Resource type scaffolding utilities.
 * - Interactive variant (`scaffoldNewResourceType`) prompts user for resource type name.
 * - Non-interactive variant (`scaffoldNonInteractive`) enables programmatic / chat-driven onboarding
 *   and now accepts optional event seeds used to populate initial TransientEvents.
 * Files created:
 *   PolicyFiles/PolicyFile_<ShortName>.json
 *   ResourceConfigs/<Env>/ResourceConfig_<ShortName>.json for each configured environment.
 */

// Lightweight event spec used during conversational scaffolding.
export interface EventSpec {
  eventId: string;
  title?: string;
  reasonType?: string; // Unplanned / Planned / Platform / etc.
  summary?: string;    // Optional summary text
}

export async function scaffoldNewResourceType(output: vscode.OutputChannel) {
  const resourceType = await vscode.window.showInputBox({ prompt: 'ARM Resource Type (e.g. Microsoft.Sample/serviceName)' });
  if (!resourceType) { return; }
  await scaffoldNonInteractive(resourceType, output);
}

async function exists(p: string) { try { await fs.access(p); return true; } catch { return false; } }

/** Non-interactive scaffold helper used by chat participant. */
export async function scaffoldNonInteractive(resourceType: string, output: vscode.OutputChannel, opts?: { events?: EventSpec[] }) {
  const shortName = resourceType.split(/[\/]/).pop() || 'Resource';
  const policyFileName = `PolicyFile_${shortName}.json`;
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) { throw new Error('No workspace folder open'); }
  const policyDir = path.join(ws.uri.fsPath, 'src/source/PolicyFiles');
  await fs.mkdir(policyDir, { recursive: true });
  const policyPath = path.join(policyDir, policyFileName);
  if (!(await exists(policyPath))) {
    // Build events section: if caller supplied explicit events use those; else fallback to sample template.
    let transientEvents: any[];
    if (opts?.events && opts.events.length) {
      transientEvents = opts.events.map(ev => ({
        EventId: ev.eventId,
        EventName: ev.eventId,
        ReasonType: ev.reasonType || 'Unplanned',
        Title: ev.title || ev.eventId,
        Summary: ev.summary || 'TODO: Describe customer impact and platform cause (40–200 chars).',
        RecommendedActions: [
          { Action: "If persistent, <action>contact support</action>", ActionUrl: "<#SupportCase>" }
        ]
      }));
    } else {
      transientEvents = [
        {
          EventId: "SampleDegraded",
          EventName: "SampleDegraded",
          ReasonType: "Unplanned",
          Title: "Degraded",
          Summary: "TODO: Describe customer impact and platform cause (40–200 chars).",
          RecommendedActions: [
            { Action: "If persistent, <action>contact support</action>", ActionUrl: "<#SupportCase>" }
          ]
        }
      ];
    }
    await fs.writeFile(policyPath, JSON.stringify({
      PersistentEvents: [],
      TransientEvents: transientEvents
    }, null, 2));
    output.appendLine(`[RHC][Scaffold] Created policy ${policyFileName}`);
  } else {
    output.appendLine(`[RHC][Scaffold] Policy ${policyFileName} already exists (skipped).`);
  }

  const envs = vscode.workspace.getConfiguration().get<string[]>('rhc.scaffold.environments') || ['Prod'];
  const rcRoot = path.join(ws.uri.fsPath, 'src/source/ResourceConfigs');
  for (const env of envs) {
    const envDir = path.join(rcRoot, env);
    await fs.mkdir(envDir, { recursive: true });
    const rcFile = path.join(envDir, `ResourceConfig_${shortName}.json`);
    if (await exists(rcFile)) { continue; }
    await fs.writeFile(rcFile, JSON.stringify({
      ResourceType: resourceType,
      PolicyFile: policyFileName,
      OwnershipId: "<OWNERSHIP_ID>",
      HealthSystemResourceType: "<HealthSystemType>",
      MdmAccounts: []
    }, null, 2));
    output.appendLine(`[RHC][Scaffold] Created config ${env}/${path.basename(rcFile)}`);
  }
}
