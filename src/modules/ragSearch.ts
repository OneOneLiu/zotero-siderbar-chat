import { RagIndex, ScoredChunk, tokenize } from "./ragIndex";

const BM25_K1 = 1.2;
const BM25_B = 0.75;

export function searchChunks(query: string, indices: RagIndex[], topK: number = 15): ScoredChunk[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || indices.length === 0) return [];

  const allChunks: { paperId: number; paperTitle: string; chunk: RagIndex["chunks"][0]; docLen: number; avgDl: number }[] = [];

  for (const idx of indices) {
    for (const chunk of idx.chunks) {
      allChunks.push({
        paperId: idx.itemId,
        paperTitle: idx.title,
        chunk,
        docLen: Object.values(chunk.terms).reduce((a, b) => a + b, 0),
        avgDl: idx.avgChunkLen || 1,
      });
    }
  }

  if (allChunks.length === 0) return [];

  const N = allChunks.length;

  const df: Record<string, number> = {};
  for (const term of queryTerms) {
    if (df[term] !== undefined) continue;
    let count = 0;
    for (const c of allChunks) {
      if (c.chunk.terms[term]) count++;
    }
    df[term] = count;
  }

  const scored: ScoredChunk[] = [];

  for (const c of allChunks) {
    let score = 0;
    for (const term of queryTerms) {
      const termFreq = c.chunk.terms[term] || 0;
      if (termFreq === 0) continue;

      const docFreq = df[term] || 0;
      const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
      const tfNorm = (termFreq * (BM25_K1 + 1)) /
        (termFreq + BM25_K1 * (1 - BM25_B + BM25_B * (c.docLen / c.avgDl)));
      score += idf * tfNorm;
    }

    if (score > 0) {
      scored.push({
        paperId: c.paperId,
        paperTitle: c.paperTitle,
        chunkId: c.chunk.id,
        section: c.chunk.section,
        text: c.chunk.text,
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
