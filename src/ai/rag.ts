// RAG helper: leverage embedding similarity to assemble context snippets.
import { similaritySearch } from './embeddings';
import { SimilarityResult } from './types';

export interface RagAnswer {
  results: SimilarityResult[];
  markdown: string; // Preformatted deterministic answer (can be replaced or wrapped by LLM later)
}

export function eventsForResourceType(resourceTypePhrase: string, limit = 15): RagAnswer {
  // Simple heuristic: strip plural 's', whitespace; later add synonyms map.
  const norm = resourceTypePhrase.trim();
  // We search with the phrase plus keyword to bias scoring.
  const query = norm + ' events';
  const sims = similaritySearch(query, limit, ['event']);
  // Filter by containing some token overlap with norm to reduce noise.
  const normLowerTokens = norm.toLowerCase().split(/\s+/).filter(Boolean);
  let filtered = sims.filter(r => normLowerTokens.some(t => r.text.toLowerCase().includes(t)) || r.score > 0.20);
  const lines: string[] = [];
  if (filtered.length === 0) {
    // Fallback: take raw top sims (unfiltered) to give user some signal.
    filtered = sims.slice(0, Math.min(5, sims.length));
    lines.push(`No strong token matches; showing top ${filtered.length} similar event(s) (fallback).`);
  } else {
    lines.push(`Events potentially related to **${norm}** (top ${filtered.length}):`);
  }
  for (const r of filtered) {
    const evId = r.meta.eventId || 'unknown';
    const title = r.meta.title ? ` — ${r.meta.title}` : '';
    const reason = r.meta.reasonType ? ` (ReasonType: ${r.meta.reasonType})` : '';
    // Use backticks in markdown code formatting; escape by breaking out of template literal.
    const file = r.meta.file ? ` in \`${r.meta.file}\`` : '';
    lines.push(`- **${evId}**${title}${reason}${file}`);
  }
  if (filtered.length === 0) {
    lines.push('No matching events found. Try refining the resource type phrasing.');
  }
  return { results: filtered, markdown: lines.join('\n') };
}
