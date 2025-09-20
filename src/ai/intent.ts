// Intent detection (MVP): fast regex-based classification for chat queries.
// Later can be augmented with LLM-based fallback if configured.
import { IntentDetection } from './types';

const EVENT_DISCOVERY_PATTERNS: RegExp[] = [
  /(what|list|show)\s+(are\s+)?(the\s+)?(possible|available)?\s*(events|event types)\s+(for|of)\s+(.+)/i,
  /possible\s+(events|event types)\s+for\s+(.+)/i
];

const SCAFFOLD_PATTERNS: RegExp[] = [
  /(create|onboard|add)\s+(a\s+)?(new\s+)?(resource\s*type|resourcetype)(\s+(.+))?/i
];

export function detectIntent(raw: string): IntentDetection {
  for (const re of EVENT_DISCOVERY_PATTERNS) {
    const m = re.exec(raw);
    if (m) {
      // resource type phrase assumed in last capturing group
      const rt = (m[m.length - 1] || '').trim();
      return { intent: 'eventDiscovery', resourceTypeQuery: rt };
    }
  }
  for (const re of SCAFFOLD_PATTERNS) {
    const m = re.exec(raw);
    if (m) {
      const name = (m[6] || '').trim();
      return { intent: 'scaffoldResourceType', resourceTypeQuery: name || undefined };
    }
  }
  return { intent: 'none' };
}
