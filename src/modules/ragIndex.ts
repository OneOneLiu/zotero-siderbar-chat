// ---------- Types ----------

export interface Chunk {
  id: number;
  text: string;
  section: string;
  terms: Record<string, number>;
}

export interface RagIndex {
  version: number;
  itemId: number;
  title: string;
  createdAt: string;
  chunks: Chunk[];
  avgChunkLen: number;
}

export interface ScoredChunk {
  paperId: number;
  paperTitle: string;
  chunkId: number;
  section: string;
  text: string;
  score: number;
}

// ---------- Constants ----------

const RAG_VERSION = 1;
const TARGET_CHUNK_WORDS = 400;
const MIN_CHUNK_WORDS = 80;
const MAX_CHUNK_WORDS = 700;
const RAG_DIR_NAME = "gemini-chat-rag";

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "this", "that",
  "these", "those", "it", "its", "i", "we", "you", "he", "she", "they",
  "me", "us", "him", "her", "them", "my", "our", "your", "his", "their",
  "what", "which", "who", "whom", "when", "where", "how", "why", "not",
  "no", "nor", "if", "then", "than", "so", "as", "just", "about", "into",
  "through", "during", "before", "after", "above", "below", "between",
  "out", "off", "over", "under", "again", "further", "once", "here",
  "there", "all", "each", "every", "both", "few", "more", "most", "other",
  "some", "such", "only", "own", "same", "also", "very", "even", "still",
  "already", "et", "al", "fig", "figure", "table", "eq", "ref",
  "的", "了", "在", "是", "和", "与", "或", "但", "也", "都",
  "就", "而", "及", "等", "对", "从", "到", "中", "上", "下",
  "个", "这", "那", "有", "被", "将", "把", "用", "为", "以",
]);

// ---------- Tokenizer ----------

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

function computeTermFreqs(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  return tf;
}

// ---------- Section Detection ----------

const SECTION_RE = /^(?:\d+\.?\s+)?(?:abstract|introduction|background|related\s*work|method(?:ology|s)?|approach|model|experiment(?:s|al)?|results?|evaluation|discussion|conclusion(?:s)?|acknowledgment(?:s)?|references|appendix|supplementary|limitations?|future\s*work|implementation|analysis|dataset(?:s)?|overview|preliminar(?:y|ies)|setup|training|inference|ablation)/i;

function detectSection(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 80) return null;
  if (SECTION_RE.test(trimmed)) return trimmed;
  if (/^\d+(\.\d+)*\s+[A-Z]/.test(trimmed) && trimmed.length < 60) return trimmed;
  return null;
}

// ---------- Chunking ----------

export function splitIntoChunks(fullText: string): Chunk[] {
  const lines = fullText.split(/\n/);
  const paragraphs: { text: string; section: string }[] = [];
  let currentSection = "";
  let buffer = "";

  for (const line of lines) {
    const sec = detectSection(line);
    if (sec) {
      if (buffer.trim()) {
        paragraphs.push({ text: buffer.trim(), section: currentSection });
        buffer = "";
      }
      currentSection = sec;
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === "") {
      if (buffer.trim()) {
        paragraphs.push({ text: buffer.trim(), section: currentSection });
        buffer = "";
      }
    } else {
      buffer += (buffer ? " " : "") + trimmed;
    }
  }
  if (buffer.trim()) {
    paragraphs.push({ text: buffer.trim(), section: currentSection });
  }

  const chunks: Chunk[] = [];
  let accumText = "";
  let accumSection = "";
  let chunkId = 0;

  for (const para of paragraphs) {
    const paraWords = para.text.split(/\s+/).length;

    if (paraWords > MAX_CHUNK_WORDS) {
      if (accumText) {
        const tokens = tokenize(accumText);
        chunks.push({ id: chunkId++, text: accumText, section: accumSection, terms: computeTermFreqs(tokens) });
        accumText = "";
      }
      const sentences = para.text.split(/(?<=[.!?。！？])\s+/);
      let sentBuf = "";
      for (const sent of sentences) {
        const combined = sentBuf ? sentBuf + " " + sent : sent;
        if (combined.split(/\s+/).length > TARGET_CHUNK_WORDS && sentBuf) {
          const tokens = tokenize(sentBuf);
          chunks.push({ id: chunkId++, text: sentBuf, section: para.section, terms: computeTermFreqs(tokens) });
          sentBuf = sent;
        } else {
          sentBuf = combined;
        }
      }
      if (sentBuf) {
        accumText = sentBuf;
        accumSection = para.section;
      }
      continue;
    }

    const currentWords = accumText ? accumText.split(/\s+/).length : 0;
    if (currentWords + paraWords > TARGET_CHUNK_WORDS && accumText) {
      const tokens = tokenize(accumText);
      chunks.push({ id: chunkId++, text: accumText, section: accumSection, terms: computeTermFreqs(tokens) });
      accumText = para.text;
      accumSection = para.section || accumSection;
    } else {
      accumText = accumText ? accumText + "\n\n" + para.text : para.text;
      if (!accumSection) accumSection = para.section;
    }
  }

  if (accumText && accumText.split(/\s+/).length >= MIN_CHUNK_WORDS) {
    const tokens = tokenize(accumText);
    chunks.push({ id: chunkId++, text: accumText, section: accumSection, terms: computeTermFreqs(tokens) });
  } else if (accumText && chunks.length > 0) {
    const last = chunks[chunks.length - 1];
    last.text += "\n\n" + accumText;
    const tokens = tokenize(last.text);
    last.terms = computeTermFreqs(tokens);
  } else if (accumText) {
    const tokens = tokenize(accumText);
    chunks.push({ id: chunkId++, text: accumText, section: accumSection, terms: computeTermFreqs(tokens) });
  }

  return chunks;
}

// ---------- Index Build ----------

function calcAvgChunkLen(chunks: Chunk[]): number {
  if (chunks.length === 0) return 0;
  const total = chunks.reduce((s, c) => s + Object.values(c.terms).reduce((a, b) => a + b, 0), 0);
  return total / chunks.length;
}

export function buildRagIndexFromText(itemId: number, title: string, fullText: string): RagIndex {
  const chunks = splitIntoChunks(fullText);
  return {
    version: RAG_VERSION,
    itemId,
    title,
    createdAt: new Date().toISOString(),
    chunks,
    avgChunkLen: calcAvgChunkLen(chunks),
  };
}

// ---------- Storage ----------

function getRagDir(): string {
  const profileDir = (Zotero as any).Profile?.dir || (Zotero as any).DataDirectory?.dir || "";
  return PathUtils.join(profileDir, RAG_DIR_NAME);
}

function getRagFilePath(itemId: number): string {
  return PathUtils.join(getRagDir(), `${itemId}_rag.json`);
}

export async function ensureRagDir(): Promise<void> {
  const dir = getRagDir();
  if (!(await IOUtils.exists(dir))) {
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });
  }
}

export async function saveRagIndex(index: RagIndex): Promise<void> {
  await ensureRagDir();
  const path = getRagFilePath(index.itemId);
  const json = JSON.stringify(index);
  const encoder = new TextEncoder();
  await IOUtils.write(path, encoder.encode(json));
}

export async function loadRagIndex(itemId: number): Promise<RagIndex | null> {
  const path = getRagFilePath(itemId);
  try {
    if (!(await IOUtils.exists(path))) return null;
    const bytes = await IOUtils.read(path);
    const text = new TextDecoder().decode(bytes);
    const data = JSON.parse(text) as RagIndex;
    if (data.version !== RAG_VERSION) return null;
    return data;
  } catch (_) {
    return null;
  }
}

export async function hasRagIndex(itemId: number): Promise<boolean> {
  const path = getRagFilePath(itemId);
  try {
    return await IOUtils.exists(path);
  } catch (_) {
    return false;
  }
}

// ---------- High-level: build from Zotero item ----------

export async function buildRagIndexForItem(item: any): Promise<RagIndex | null> {
  const att = item.isAttachment?.() ? item : (() => {
    if (!item.isRegularItem?.()) return null;
    for (const id of item.getAttachments()) {
      const a = Zotero.Items.get(id);
      if (a && !a.isNote() && a.attachmentContentType === "application/pdf") return a;
    }
    return null;
  })();

  if (!att) return null;

  const state = await Zotero.Fulltext.getIndexedState(att);
  if (state !== (Zotero.Fulltext.INDEX_STATE_INDEXED || 2)) {
    await Zotero.Fulltext.indexItems([att.id]);
    await Zotero.Promise.delay(1500);
  }

  const cf = Zotero.Fulltext.getItemCacheFile(att);
  if (!cf || !(await IOUtils.exists(cf.path))) return null;

  const raw = await Zotero.File.getContentsAsync(cf.path) as any;
  const fullText = typeof raw === "string" ? raw : new TextDecoder().decode(raw as Uint8Array);
  if (!fullText?.trim()) return null;

  const parent = att.parentItem || att;
  const title = String(parent.getField?.("title") || "Untitled");
  const parentId = parent.isAttachment?.() ? parent.id : (item.isRegularItem?.() ? item.id : att.id);

  const index = buildRagIndexFromText(parentId, title, fullText);
  await saveRagIndex(index);
  return index;
}
