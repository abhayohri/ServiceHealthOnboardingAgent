// Pseudo embedding helpers reused by multiple modules.
// NOTE: Kept separate from embeddings.ts so provider implementations can reuse without circular dependency.

export function pseudoEmbedVector(text: string, dims: number): number[] {
  const v = new Array(dims).fill(0);
  // Normalize separators, then inject spaces before camelCase boundaries so 'virtualMachines' -> 'virtual Machines'.
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
