// Embedding provider abstraction. Allows swapping pseudo local vectors with Azure OpenAI (stubbed).
import * as vscode from 'vscode';

// Local pseudo embedding logic (duplicated from pseudo.ts to avoid import path resolution edge case).
function pseudoEmbedVector(text: string, dims: number): number[] {
  const v = new Array(dims).fill(0);
  const expanded = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ');
  const normText = expanded.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const tokens = normText.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    let h = 0;
    for (let i = 0; i < tok.length; i++) {
      h = (h * 31 + tok.charCodeAt(i)) >>> 0;
    }
    v[h % dims] += 1;
  }
  let sumSq = 0; for (const x of v) sumSq += x * x;
  const inv = sumSq ? 1 / Math.sqrt(sumSq) : 1;
  for (let i = 0; i < v.length; i++) v[i] = v[i] * inv;
  return v;
}

export interface Embedder {
  dims: number;
  embed(texts: string[]): Promise<number[][]>;
}

class LocalPseudoEmbedder implements Embedder {
  dims = 128;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(t => pseudoEmbedVector(t, this.dims));
  }
}

class AzureOpenAIStubEmbedder implements Embedder {
  dims = 1536; // typical embedding size
  async embed(texts: string[]): Promise<number[][]> {
    // Placeholder: In real implementation call Azure OpenAI Embeddings REST API.
    // For now delegate to pseudo while keeping dims constant for deterministic behavior.
    return texts.map(t => pseudoEmbedVector(t, this.dims));
  }
}

export function createEmbedder(): Embedder {
  const cfg = vscode.workspace.getConfiguration();
  const provider = cfg.get<string>('rhc.ai.embeddingProvider', 'local-pseudo');
  switch (provider) {
    case 'azureOpenAI':
      return new AzureOpenAIStubEmbedder();
    default:
      return new LocalPseudoEmbedder();
  }
}
