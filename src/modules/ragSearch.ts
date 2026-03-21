import { RagIndex, ScoredChunk, tokenize } from "./ragIndex";

const BM25_K1 = 1.2;
const BM25_B = 0.75;

const MIN_ABSOLUTE_SCORE = 0.5;
const MIN_RELATIVE_SCORE = 0.25;

interface ChunkEntry {
  paperId: number;
  paperTitle: string;
  chunk: RagIndex["chunks"][0];
  docLen: number;
  avgDl: number;
}

function scoreAllChunks(query: string, indices: RagIndex[]): ScoredChunk[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || indices.length === 0) return [];

  const allChunks: ChunkEntry[] = [];
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
  return scored;
}

/**
 * Original global search: pool all chunks, rank globally, return top K.
 */
export function searchChunks(query: string, indices: RagIndex[], topK: number = 15): ScoredChunk[] {
  const scored = scoreAllChunks(query, indices);
  if (scored.length === 0) return [];

  scored.sort((a, b) => b.score - a.score);
  const maxScore = scored[0].score;
  const threshold = Math.max(MIN_ABSOLUTE_SCORE, maxScore * MIN_RELATIVE_SCORE);
  return scored.filter(s => s.score >= threshold).slice(0, topK);
}

/**
 * Balanced per-paper search: each paper contributes 0 to maxPerPaper chunks,
 * ensuring coverage across all relevant papers instead of one paper dominating.
 *
 * Strategy:
 * 1. BM25 scores are computed globally (shared IDF) for cross-paper comparability.
 * 2. A global relevance threshold filters out truly irrelevant chunks.
 * 3. Within each paper, chunks are ranked and capped at maxPerPaper.
 * 4. Papers whose best chunk is below the per-paper threshold contribute 0 chunks.
 * 5. Combined results are sorted by score and capped at totalCap.
 */
export function searchChunksBalanced(
  query: string,
  indices: RagIndex[],
  maxPerPaper: number = 3,
  totalCap: number = 30,
): ScoredChunk[] {
  const scored = scoreAllChunks(query, indices);
  if (scored.length === 0) return [];

  const globalMaxScore = Math.max(...scored.map(s => s.score));
  const globalThreshold = Math.max(MIN_ABSOLUTE_SCORE, globalMaxScore * MIN_RELATIVE_SCORE);

  // Within each paper, also require the best chunk to be at least 15% of the
  // global max — this filters out papers with only marginal keyword overlap.
  const perPaperMinScore = globalMaxScore * 0.15;
  const effectiveThreshold = Math.max(globalThreshold, perPaperMinScore);

  const paperGroups = new Map<number, ScoredChunk[]>();
  for (const s of scored) {
    if (s.score < effectiveThreshold) continue;
    if (!paperGroups.has(s.paperId)) paperGroups.set(s.paperId, []);
    paperGroups.get(s.paperId)!.push(s);
  }

  const balanced: ScoredChunk[] = [];
  for (const [, chunks] of paperGroups) {
    chunks.sort((a, b) => b.score - a.score);
    balanced.push(...chunks.slice(0, maxPerPaper));
  }

  balanced.sort((a, b) => b.score - a.score);
  return balanced.slice(0, totalCap);
}
