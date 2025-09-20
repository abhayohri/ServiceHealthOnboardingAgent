// Shared AI-related type definitions for RHC.
// Keeping these small and dependency-free allows easy future swapping of embedding / LLM providers.

export interface EmbeddingRecord {
  id: string;                 // Unique identifier (e.g. event:<policyFile>#<eventId> or doc:<path>#<chunkIndex>)
  kind: 'event' | 'policy' | 'doc';
  resourceType?: string;      // Inferred resource type for event/policy records
  text: string;               // Raw text used for embedding (already normalized)
  vector: number[];           // Normalized embedding vector
  meta: Record<string, any>;  // Lightweight metadata (file, eventId, title, etc.)
}

export interface EmbeddingIndexFile {
  version: number;            // Increment if format changes
  created: string;            // ISO timestamp
  records: EmbeddingRecord[];
  dims: number;               // Dimensionality
  sourceMtimeHash?: string;   // Hash to detect stale index relative to source files
}

export interface SimilarityResult<TMeta = any> {
  id: string;
  score: number;              // Cosine similarity (0-1 range ideally)
  meta: TMeta;
  text: string;
}

export interface IntentDetection {
  intent: 'eventDiscovery' | 'scaffoldResourceType' | 'none';
  resourceTypeQuery?: string; // Raw resource type phrase if extracted
}

export interface RagQueryOptions {
  limit?: number;             // Max results
  filterKind?: ('event' | 'policy' | 'doc')[];
  resourceTypeHint?: string;  // Narrow search
}
