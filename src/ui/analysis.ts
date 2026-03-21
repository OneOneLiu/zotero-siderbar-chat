import MarkdownIt from "markdown-it";
// @ts-ignore
import tm from "markdown-it-texmath";
import katex from "katex";
import { config } from "../../package.json";
import {
  type RagIndex,
  buildRagIndexFromText,
  loadRagIndex,
  hasRagIndex,
  saveRagIndex,
  ensureRagDir,
  splitIntoChunks,
  tokenize,
} from "../modules/ragIndex";
import { searchChunksBalanced } from "../modules/ragSearch";

// ---------- Globals resolution ----------

function getZotero(): any {
  const w = window as any;
  return w.Zotero || w.parent?.Zotero || w.opener?.Zotero || w.top?.Zotero;
}
function getIOUtils(): any {
  const w = window as any;
  return w.IOUtils || w.parent?.IOUtils || w.opener?.IOUtils || w.top?.IOUtils;
}

let Zotero: any = null;
let IOUtils: any = null;

function ensureGlobals() {
  if (!Zotero) Zotero = getZotero();
  if (!IOUtils) IOUtils = getIOUtils();
  // Expose resolved globals on window so that imported ragIndex.ts functions
  // (which use bare Zotero/IOUtils/PathUtils globals) can access them in this iframe context.
  const w = window as any;
  if (Zotero && !w.Zotero) w.Zotero = Zotero;
  if (IOUtils && !w.IOUtils) w.IOUtils = IOUtils;
  // PathUtils is used by ragIndex.ts for file path operations
  if (!w.PathUtils) {
    w.PathUtils = w.parent?.PathUtils || w.opener?.PathUtils || w.top?.PathUtils;
  }
  if (!Zotero) throw new Error("Zotero is not available. Please reopen this window from the Zotero context menu.");
}

// ---------- Markdown ----------

let md: any = null;
function getMarkdown() {
  if (!md) {
    md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true });
    try {
      md.use(tm, { engine: katex, delimiters: "dollars", katexOptions: { output: "html", throwOnError: false } });
    } catch (_e) { /* optional */ }
  }
  return md;
}

// ---------- Types ----------

interface PaperInfo { id: number; title: string; }
interface ChatMsg { role: "user" | "model" | "system"; text: string; }

// ---------- State ----------

let papers: PaperInfo[] = [];
let chatHistory: ChatMsg[] = [];
let analysisDoc = "";
let questionUnderstandingDoc = "";
let busy = false;
let savedNoteId: number | null = null;
let ragIndices: Map<number, RagIndex> = new Map();

// ---------- Settings ----------

function getSettings() {
  const Z = Zotero || getZotero();
  if (!Z) throw new Error("Zotero is not available in this window context");
  const pfx = config.prefsPrefix;
  const provider = (Z.Prefs.get(`${pfx}.provider`, true) as string) || "gemini";
  const defaultBases: Record<string, string> = {
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    deepseek: "https://api.deepseek.com",
    doubao: "https://ark.cn-beijing.volces.com/api/v3",
  };
  const concurrencyStr = (Z.Prefs.get(`${pfx}.concurrency`, true) as string) || "4";
  const defaultModels: Record<string, string> = {
    gemini: "gemini-1.5-flash-latest",
    deepseek: "deepseek-chat",
    doubao: "doubao-seed-1-6-flash-250615",
  };
  const mainModel = (Z.Prefs.get(`${pfx}.model`, true) as string) || defaultModels[provider] || "gemini-1.5-flash-latest";
  const extractionModelPref = (Z.Prefs.get(`${pfx}.extractionModel`, true) as string) || "__same__";
  const extractionModel = (!extractionModelPref || extractionModelPref === "__same__" || extractionModelPref === "__custom__")
    ? mainModel : extractionModelPref;

  const defaultQuestionUnderstandingPrompt = `# Role: 资深学术研究助理

你是一个专门针对各类学术问题进行针对性解答的AI专家。你精通研究问题的逻辑拆解和核心概念的精准界定。所有分析必须严谨、客观、无歧义。

## Task: 问题解构与概念澄清

用户提出了以下研究问题：
"""
{question}
"""

请严格按照以下步骤对该问题进行深度解析：

### 1. 核心意图分析
判断该问题的类型（概念类「是什么」/ 动机类「为什么」/ 存在类「有没有」/ 对比类「有何区别」/ 复合类），提取清晰、客观的核心诉求，理解用户真正想要知道什么。

### 2. 关键词提取与概念界定
- 提取所有核心关键词，逐一澄清和辨析，消除一切歧义。
- 尽可能使用清晰的自然语言表述概念，能定量的必须定量（尤其是形容词或修饰性名词）。技术概念能用数学思想表述的必须用数学思想表述。
- 检查提问中使用的词汇是否为标准学术概念。若发现非标准用词，必须指出并提供标准学术术语。
- 对模糊概念给出一个无歧义的工作定义，作为后续分析的基准（兜底定义机制）。

### 3. 衍生问题拆解
采用"打破砂锅问到底"的原则追根溯源，罗列出一系列与问题来龙去脉相关的基本或衍生子问题：
- 必须包含至少一个概念性子问题："什么是[X]？领域对它是否有清晰无歧义的定义？"
- 必须包含至少一个动机性子问题："为什么要[X]？"
- 其他帮助回答总问题的原子化子问题
- 每个子问题应尽量短，不涉及过多概念，确保是基本的原子问题
- 这些子问题必须能构成一条清晰的回答脉络

### 4. 问题理解总结
将以上分析凝练为一段结构化总结，严格使用如下格式：
> "用户提出了一个关于[xxx]的问题。核心关键词包括：1.[xxx] 2.[xxx]...。其中[xxx]是无歧义的专业学术术语，[xxx]可能存在歧义需要澄清，消除歧义后的工作定义为[xxx]。综合分析，用户的核心目的是[xxx]。为全面、透彻地回答此问题，需要逐一解答以下子问题：1.[xxx] 2.[xxx]..."

请使用与用户问题相同的语言输出。`;

  const defaultExtractionPrompt = `# Role: 学术文献信息萃取专家

你是一个精通文献信息提取和相关性判定的AI专家。你的所有分析必须百分之百基于文献原文，拒绝任何形式的幻觉和无端发散。

## Context: 问题理解

以下是对用户研究问题的深度分析：
"""
{understanding}
"""

用户的原始研究问题是：
"""
{question}
"""

## Task: 单文献信息萃取

请针对提供的论文进行以下客观分析：

### Part A: 核心要素提取（每项2-4句）
1. **研究问题与动机**：该论文解决什么问题？现有方法有哪些局限性？
2. **核心贡献**：主要贡献点（1-3个）
3. **研究方法**：核心方法、关键创新点及方法大类
4. **实验结果**：数据集、关键指标与主要发现
5. **局限性**：已知局限（若原文未提及，标注"未提及"并分析可能原因及对解答本问题的影响）
6. **可复现性**：代码/数据是否公开

### Part B: 问题相关性锚定
结合上述问题理解中的核心概念和子问题，判定该文献的相关性：
- 逐一检查每个子问题，标注该文献是否包含相关信息
- 若相关，提取具体细节和证据，注意概念定义的定量一致性
- 若该文献与问题确实不相关，明确指出并给出理由，建议用户考虑剔除

### Part C: 关键信息凝练
将提取的核心内容及与问题相关的要点凝练成一段简短总结备用。

请使用与用户问题相同的语言输出。若原文未提及某项信息，客观标注"未提及"，切勿编造。`;

  const defaultSynthesisPrompt = `# Role: 多文献交叉分析与综合专家

你是一个精通多文献信息交叉比对和综合分析的AI专家。你的回答必须严谨客观，所有结论必须有文献支撑。保持中立立场，仅做事实和逻辑的分析。

## Context: 问题理解

以下是对用户研究问题的深度分析：
"""
{understanding}
"""

用户的原始研究问题是：
"""
{question}
"""

以下是从 {count} 篇论文中提取的结构化信息。

## Task: 多文献交叉比对与综合分析

请严格按照以下步骤进行分析和输出：

### <Thinking_Process>：交叉比对与证据网络构建

1. **概念与差异对齐**：消除文献间的浅层差异（用词差异、实验场景差异等），从宏观整体的角度定位它们的核心内容。
2. **逻辑验证与关系排查**：
   - 围绕问题理解中的核心关键词和各个子问题展开
   - 检查各论文对核心概念的定义和表述从定量角度是否一致
   - 检查文献间是否相互支撑或相互矛盾
   - 检查是否存在清晰的研究发展脉络（若无法形成，给出理由）
3. **证据图谱构建**：围绕每个子问题进行初步回答和关系分析，形成"论点-证据链"网络。

### <Final_Answer>：双版本解答输出

基于以上分析，首先澄清核心概念的定义与技术脉络，然后给出两个版本的回答。两个版本都必须在第一句给出清晰的总结性答案（结论先行），随后展开有理有据的逻辑论证。

**版本一：严谨学术版 (Academic Rigorous Version)**
- 先澄清所有核心定义（是什么）和动机（为什么）
- 用词严格符合学术规范，核心概念定义准确无歧义
- 在此基础上形成具有清晰脉络的回答，确保逻辑严密
- 引用具体论文作为证据来源

**版本二：通俗易懂版 (Layman Accessible Version)**
- 以直白易懂的语言澄清核心定义和动机
- 可适当简化细节，但不能引入技术错误或歧义
- 确保非专业读者也能理解

### 注意事项
- 如发现文献间存在矛盾或争议，必须明确指出并给出理由（批判性思维）
- 如某些子问题无法从文献中找到答案，标注为"当前文献未覆盖"
- 指出现有文献中的研究空白和可能的后续方向

请使用与用户问题相同的语言输出，引用具体论文作为证据来源。`;

  const defaultFollowUpPrompt = `# Role: 基于多文献分析的学术追问助理

你是一个资深学术研究助理。你之前已经完成了对用户研究问题的深度分析（包括问题理解、单篇文献提取和多文献综合），现在用户在此基础上提出了追问。

## 可用上下文

你的上下文中可能包含以下信息：
1. **问题理解文档**：对用户初始研究问题的结构化分析（核心概念定义、子问题拆解等）
2. **之前的分析摘要**：从各篇论文中提取的结构化信息
3. **RAG 检索段落**：根据当前追问从原始论文全文中检索到的相关原文段落
4. **对话历史**：之前的问答记录

## 回答原则

1. **严格基于证据**：回答必须基于提供的文献内容和 RAG 检索结果，引用具体论文作为来源。绝对不要编造文献中没有的信息。
2. **概念一致性**：延续之前问题理解中已经澄清的概念定义和术语，不要在追问中悄悄改变定义。
3. **诚实标注边界**：如果提供的文献和 RAG 段落无法回答某个方面，必须明确说明"当前文献未覆盖此内容"或"提供的文献中未找到相关信息"，不要凭空推测。
4. **批判性思维**：如发现矛盾点或争议，需明确指出并给出理由。
5. **结论先行**：先给出清晰的结论，再展开论证。
6. **语言一致**：使用与用户问题相同的语言回答。

## 用户追问

{question}`;

  const ragChunksStr = (Z.Prefs.get(`${pfx}.ragChunksPerQuery`, true) as string) || "30";
  const ragPerPaperStr = (Z.Prefs.get(`${pfx}.ragMaxChunksPerPaper`, true) as string) || "3";
  return {
    provider,
    apiBase: (Z.Prefs.get(`${pfx}.apiBase`, true) as string) || defaultBases[provider] || defaultBases.gemini,
    model: mainModel,
    extractionModel,
    apiKey: (Z.Prefs.get(`${pfx}.apiKey`, true) as string) || "",
    concurrency: Math.max(1, Math.min(8, parseInt(concurrencyStr, 10) || 4)),
    questionUnderstandingPrompt: (Z.Prefs.get(`${pfx}.questionUnderstandingPrompt`, true) as string) || defaultQuestionUnderstandingPrompt,
    extractionPrompt: (Z.Prefs.get(`${pfx}.extractionPrompt`, true) as string) || defaultExtractionPrompt,
    synthesisPrompt: (Z.Prefs.get(`${pfx}.synthesisPrompt`, true) as string) || defaultSynthesisPrompt,
    followUpPrompt: (Z.Prefs.get(`${pfx}.followUpPrompt`, true) as string) || defaultFollowUpPrompt,
    ragChunksPerQuery: Math.max(5, Math.min(60, parseInt(ragChunksStr, 10) || 30)),
    ragMaxChunksPerPaper: Math.max(1, Math.min(10, parseInt(ragPerPaperStr, 10) || 3)),
  };
}

// ---------- PDF helpers ----------

function getBestPdfAttachment(item: any): any {
  if (item.isAttachment?.() && item.attachmentContentType === "application/pdf") return item;
  if (item.isRegularItem?.()) {
    for (const id of item.getAttachments()) {
      const att = Zotero.Items.get(id);
      if (att && !att.isNote() && att.attachmentContentType === "application/pdf") return att;
    }
  }
  return null;
}

async function getPdfBase64(item: any): Promise<{ mimeType: string; data: string } | null> {
  const att = item.isAttachment?.() ? item : getBestPdfAttachment(item);
  if (!att) return null;
  const path = await att.getFilePathAsync();
  if (!path) return null;
  try {
    const bytes = await IOUtils.read(path);
    const u8 = new Uint8Array(bytes);
    let bin = "";
    for (let i = 0; i < u8.byteLength; i++) {
      bin += String.fromCharCode(u8[i]);
    }
    return { mimeType: "application/pdf", data: btoa(bin) };
  } catch (_e) { return null; }
}

async function getPdfText(item: any): Promise<string | null> {
  try {
    const state = await Zotero.Fulltext.getIndexedState(item);
    if (state !== (Zotero.Fulltext.INDEX_STATE_INDEXED || 2)) {
      await Zotero.Fulltext.indexItems([item.id]);
      await Zotero.Promise.delay(1000);
    }
    const cf = Zotero.Fulltext.getItemCacheFile(item);
    if (cf && await IOUtils.exists(cf.path)) {
      const c = await Zotero.File.getContentsAsync(cf.path);
      const t = typeof c === "string" ? c : new TextDecoder().decode(c);
      if (t?.trim()) return t.trim();
    }
    return null;
  } catch (_e) { return null; }
}

// ---------- RAG helpers ----------

async function ensureRagForPaper(paperId: number): Promise<RagIndex | null> {
  if (ragIndices.has(paperId)) return ragIndices.get(paperId)!;

  let idx = await loadRagIndex(paperId);
  if (idx) {
    ragIndices.set(paperId, idx);
    return idx;
  }

  const zItem = Zotero.Items.get(paperId);
  if (!zItem) return null;
  const pdf = getBestPdfAttachment(zItem);
  if (!pdf) return null;

  const text = await getPdfText(pdf);
  if (!text) return null;

  const parent = pdf.parentItem || pdf;
  const title = String(parent.getField?.("title") || "Untitled");
  idx = buildRagIndexFromText(paperId, title, text);
  await saveRagIndex(idx);
  ragIndices.set(paperId, idx);
  return idx;
}

async function buildRagIndicesForPapers(paperIds: number[], onProgress?: (done: number, total: number, title: string) => void): Promise<void> {
  await ensureRagDir();
  for (let i = 0; i < paperIds.length; i++) {
    const pid = paperIds[i];
    const p = papers.find(pp => pp.id === pid);
    if (onProgress) onProgress(i, paperIds.length, p?.title || "");
    await ensureRagForPaper(pid);
  }
  if (onProgress) onProgress(paperIds.length, paperIds.length, "");
}

// ---------- AI helpers ----------

function buildEndpoint(s: ReturnType<typeof getSettings>, stream: boolean, modelOverride?: string) {
  const model = modelOverride || s.model;
  if (s.provider === "gemini") return `${s.apiBase}/models/${model}:${stream ? "streamGenerateContent" : "generateContent"}?key=${s.apiKey}`;
  return `${s.apiBase}/chat/completions`;
}

function formatPayload(s: ReturnType<typeof getSettings>, contents: any[], stream: boolean, modelOverride?: string) {
  if (s.provider === "gemini") return { contents };
  const model = modelOverride || s.model;
  const msgs = contents.map(c => ({
    role: c.role === "model" ? "assistant" : c.role,
    content: c.parts.filter((p: any) => p.text).map((p: any) => p.text).join("\n"),
  }));
  return { model, messages: msgs, stream };
}

function buildHeaders(s: ReturnType<typeof getSettings>) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (s.provider !== "gemini") h["Authorization"] = `Bearer ${s.apiKey}`;
  return h;
}

const TIMEOUT_MS = 300000; // 5 minutes
const MAX_RETRIES = 2;

async function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url: string, opts: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await delay(Math.min(2000 * Math.pow(2, attempt), 15000));
          continue;
        }
      }
      return res;
    } catch (e: any) {
      if (attempt < retries && (e?.name === "AbortError" || /network/i.test(e?.message || ""))) {
        await delay(Math.min(3000 * Math.pow(2, attempt), 20000));
        continue;
      }
      throw e;
    }
  }
  throw new Error("Max retries exceeded");
}

async function callAI(s: ReturnType<typeof getSettings>, contents: any[], modelOverride?: string): Promise<string> {
  const res = await fetchWithRetry(buildEndpoint(s, false, modelOverride), { method: "POST", headers: buildHeaders(s), body: JSON.stringify(formatPayload(s, contents, false, modelOverride)) });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const j: any = await res.json();
  if (s.provider === "gemini") {
    const c = j?.candidates || j?.[0]?.candidates;
    if (c?.[0]?.content?.parts?.[0]?.text) return c[0].content.parts[0].text;
    if (Array.isArray(j)) { let f = ""; for (const x of j) { const t = x?.candidates?.[0]?.content?.parts?.[0]?.text; if (t) f += t; } if (f) return f; }
    throw new Error("Unexpected Gemini response");
  }
  return j?.choices?.[0]?.message?.content || (() => { throw new Error("Unexpected response"); })();
}

async function* callAIStream(s: ReturnType<typeof getSettings>, contents: any[], modelOverride?: string): AsyncGenerator<string> {
  const res = await fetchWithRetry(buildEndpoint(s, true, modelOverride), { method: "POST", headers: buildHeaders(s), body: JSON.stringify(formatPayload(s, contents, true, modelOverride)) });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  if (!res.body) throw new Error("No body");
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let si = 0;
      while (si < buf.length) {
        const st = buf.indexOf("{", si); if (st === -1) break;
        let d = 0, e = -1, ins = false, esc2 = false;
        for (let i = st; i < buf.length; i++) {
          const ch = buf[i];
          if (esc2) { esc2 = false; continue; } if (ch === "\\") { esc2 = true; continue; }
          if (ch === '"') { ins = !ins; continue; }
          if (!ins) { if (ch === "{") d++; if (ch === "}") { d--; if (d === 0) { e = i; break; } } }
        }
        if (e !== -1) {
          try {
            const p = JSON.parse(buf.substring(st, e + 1));
            const t = s.provider === "gemini" ? p?.candidates?.[0]?.content?.parts?.[0]?.text : p?.choices?.[0]?.delta?.content;
            if (t) yield t;
          } catch (_) { /* skip */ }
          buf = buf.substring(e + 1); si = 0;
        } else { si = st + 1; break; }
      }
    }
  } finally { reader.releaseLock(); }
}

// ---------- Context building ----------

// ---------- RAG query rewriting ----------

const HAS_NON_LATIN_RE = /[^\u0000-\u024F\u1E00-\u1EFF]/;

async function rewriteQueryForSearch(settings: ReturnType<typeof getSettings>, userQuery: string): Promise<string> {
  // If query is purely Latin-based, use it directly
  if (!HAS_NON_LATIN_RE.test(userQuery)) return userQuery;

  // Use a lightweight AI call to extract English search keywords
  try {
    const prompt = `Extract English academic search keywords from the following query. Return ONLY the keywords separated by spaces, no explanation, no punctuation. If the query is about a concept, include the English term and closely related terms.\n\nQuery: ${userQuery}`;
    const contents = [{ role: "user" as const, parts: [{ text: prompt }] }];
    const keywords = await callAI(settings, contents, settings.extractionModel);
    const cleaned = keywords.trim().replace(/[,;.，；。、\n]/g, " ").replace(/\s+/g, " ");
    if (cleaned.length > 0 && cleaned.length < 500) {
      return `${cleaned} ${userQuery}`;
    }
  } catch (_) { /* fall through to original query */ }

  return userQuery;
}

// ---------- Context building ----------

function getCheckedPaperIds(): number[] {
  return papers.map(p => p.id);
}

async function buildContextParts(settings: ReturnType<typeof getSettings>, userQuery: string): Promise<{ parts: any[]; ragInfo: string }> {
  const checkedIds = getCheckedPaperIds();
  const parts: any[] = [];
  let ragInfo = "";

  if (questionUnderstandingDoc) {
    parts.push({ text: `[Question Understanding]\n\n${questionUnderstandingDoc}` });
  }

  if (analysisDoc) {
    parts.push({ text: `[Previous Analysis Summary]\n\n${analysisDoc}` });
  }

  if (checkedIds.length > 0 && userQuery) {
    const indices: RagIndex[] = [];
    for (const pid of checkedIds) {
      const idx = ragIndices.get(pid) || await ensureRagForPaper(pid);
      if (idx) indices.push(idx);
    }
    updateRagStatusIndicators();

    if (indices.length > 0) {
      const totalChunks = indices.reduce((s, idx) => s + idx.chunks.length, 0);

      // Rewrite query for cross-language search
      const searchQuery = await rewriteQueryForSearch(settings, userQuery);
      const results = searchChunksBalanced(searchQuery, indices, settings.ragMaxChunksPerPaper, settings.ragChunksPerQuery);

      const queryNote = searchQuery !== userQuery ? ` (expanded: "${searchQuery.substring(0, 80)}...")` : "";

      if (results.length > 0) {
        const grouped: Record<string, { section: string; text: string; score: number }[]> = {};
        for (const r of results) {
          if (!grouped[r.paperTitle]) grouped[r.paperTitle] = [];
          grouped[r.paperTitle].push({ section: r.section, text: r.text, score: r.score });
        }

        const paperCount = Object.keys(grouped).length;
        const chunkCounts = Object.entries(grouped).map(([t, cs]) => `${t}(${cs.length})`).join(", ");

        let contextText = `[RAG Context — ${results.length} passages balanced across ${paperCount} paper(s), max ${settings.ragMaxChunksPerPaper}/paper]\n`;
        contextText += `The following are ORIGINAL text passages extracted directly from the papers' full text, retrieved via balanced per-paper keyword search based on the user's question.\n\n`;

        let passageNum = 0;
        for (const [title, passages] of Object.entries(grouped)) {
          contextText += `=== Paper: ${title} (${passages.length} passage(s)) ===\n\n`;
          for (const p of passages) {
            passageNum++;
            const sectionLabel = p.section ? ` | Section: ${p.section}` : "";
            contextText += `--- Passage ${passageNum}${sectionLabel} ---\n${p.text}\n\n`;
          }
        }

        parts.push({ text: contextText });
        ragInfo = `🔍 RAG (balanced): ${results.length} passages from ${paperCount}/${indices.length} paper(s) [${chunkCounts}] (searched ${totalChunks} chunks)${queryNote}`;
      } else {
        ragInfo = `🔍 RAG: no matching passages found (searched ${totalChunks} chunks across ${indices.length} paper(s))${queryNote}`;
      }
    } else {
      ragInfo = `⚠️ RAG: no indices available (0/${checkedIds.length} papers indexed)`;
    }
  }

  return { parts, ragInfo };
}

// ---------- Save helpers ----------

function getPaperMetadata(paperId: number): string {
  try {
    const item = Zotero.Items.get(paperId);
    if (!item) return "";
    const parent = item.isAttachment?.() ? item.parentItem : item;
    if (!parent) return "";

    const title = parent.getField("title") || "Untitled";
    const year = parent.getField("year") || parent.getField("date")?.substring(0, 4) || "";
    const journal = parent.getField("publicationTitle") || parent.getField("proceedingsTitle") || "";
    const doi = parent.getField("DOI") || "";
    const url = parent.getField("url") || "";
    const abstractText = parent.getField("abstractNote") || "";

    let authors = "";
    try {
      const creators = parent.getCreators?.() || [];
      authors = creators
        .filter((c: any) => c.creatorType === "author" || c.creatorType === "contributor")
        .map((c: any) => c.firstName ? `${c.lastName}, ${c.firstName}` : c.lastName || c.name || "")
        .filter(Boolean)
        .join("; ");
    } catch (_) { /* ignore */ }

    let lines = [`**${esc(title)}**`];
    if (authors) lines.push(`Authors: ${esc(authors)}`);
    if (year) lines.push(`Year: ${esc(year)}`);
    if (journal) lines.push(`Publication: ${esc(journal)}`);
    if (doi) lines.push(`DOI: ${esc(doi)}`);
    if (url) lines.push(`URL: ${esc(url)}`);
    if (abstractText) lines.push(`Abstract: ${esc(abstractText.length > 300 ? abstractText.substring(0, 300) + "..." : abstractText)}`);
    return lines.join("\n");
  } catch (_) { return ""; }
}

function buildPaperInfoSection(): string {
  let md = "# Paper Information\n\n";
  papers.forEach((p, i) => {
    md += `## Paper ${i + 1}\n\n`;
    const meta = getPaperMetadata(p.id);
    md += meta ? meta + "\n\n" : `**${esc(p.title)}**\n\n`;
  });
  return md;
}

async function saveAnalysisNote() {
  try {
    const firstItem = Zotero.Items.get(papers[0]?.id);
    if (!firstItem) return;
    const parentId = firstItem.isAttachment?.() ? firstItem.parentID : firstItem.id;
    if (!parentId) return;

    let note: any;
    if (savedNoteId) {
      try {
        const existing = Zotero.Items.get(savedNoteId);
        if (existing && !existing.deleted && existing.isNote()) note = existing;
      } catch (_) { /* ignore */ }
    }
    if (!note) {
      note = new Zotero.Item("note");
      note.parentID = parentId;
    }

    const paperInfoHtml = renderMd(buildPaperInfoSection());

    let quHtml = "";
    if (questionUnderstandingDoc) {
      quHtml = `<h1>Question Understanding</h1>${renderMd(questionUnderstandingDoc)}`;
    }

    let extractionsHtml = "";
    if (analysisDoc) {
      extractionsHtml = `<h1>Per-paper Extractions</h1>${renderMd(analysisDoc)}`;
    }

    let chatHtml = "<h1>Chat History</h1>";
    let turnNum = 0;
    for (let i = 0; i < chatHistory.length; i++) {
      const msg = chatHistory[i];
      if (msg.role === "user") {
        turnNum++;
        chatHtml += `<h2>Round ${turnNum}</h2>`;
        chatHtml += `<p><strong>🧑 Question:</strong></p>`;
        chatHtml += `<blockquote>${renderMd(msg.text)}</blockquote>`;
      } else if (msg.role === "model") {
        chatHtml += `<p><strong>🤖 Answer:</strong></p>`;
        chatHtml += renderMd(msg.text);
        chatHtml += `<hr/>`;
      } else {
        chatHtml += `<p><em>ℹ️ ${esc(msg.text)}</em></p>`;
      }
    }

    const timestamp = new Date().toLocaleString();
    const html = `<h1>📊 Multi-paper Analysis</h1>
<p><em>Saved: ${timestamp}</em></p>
<hr/>
${paperInfoHtml}
<hr/>
${quHtml}
<hr/>
${extractionsHtml}
<hr/>
${chatHtml}`;

    note.setNote(html);
    await note.saveTx();
    savedNoteId = note.id;
  } catch (_e) { /* save is non-critical */ }
}

// ---------- DOM helpers ----------

function $(id: string) { return document.getElementById(id)!; }

function isNearBottom(): boolean {
  const el = $("chat-messages");
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollToBottom(force = false) {
  if (!force && !isNearBottom()) return;
  const el = $("chat-messages");
  el.scrollTop = el.scrollHeight;
}

function addMessageBubble(role: "user" | "model" | "system", html: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.innerHTML = html;
  $("chat-messages").appendChild(el);
  scrollToBottom(true);
  return el;
}

function renderMd(text: string): string {
  try { return getMarkdown().render(text); } catch (_) { return esc(text); }
}

function esc(t: string) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escAttr(t: string) { return t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// ---------- First-message: full analysis pipeline ----------

async function runInitialAnalysis(userPrompt: string, settings: ReturnType<typeof getSettings>) {
  const allPdfs: { pdfItem: any; title: string }[] = [];
  for (const p of papers) {
    const z = Zotero.Items.get(p.id);
    if (!z) continue;
    const pdf = getBestPdfAttachment(z);
    if (pdf) allPdfs.push({ pdfItem: pdf, title: p.title });
  }

  if (allPdfs.length === 0) throw new Error("No PDF attachments found.");

  // === Phase 1: Build RAG indices (local only, no API calls) ===
  const ragBubble = addMessageBubble("system", "");
  try {
    await ensureRagDir();
    let ragBuilt = 0, ragCached = 0, ragFailed = 0;
    for (let i = 0; i < papers.length; i++) {
      const p = papers[i];
      const alreadyReady = ragIndices.has(p.id) || await hasRagIndex(p.id);
      ragBubble.innerHTML = `<strong>🔍 Phase 1/4 — Preparing search index — ${i + 1}/${papers.length}</strong><br>` +
        (alreadyReady ? `📦 Loading: ${esc(p.title)}` : `🔨 Building: ${esc(p.title)}`);
      scrollToBottom();
      try {
        await ensureRagForPaper(p.id);
        if (alreadyReady) ragCached++; else ragBuilt++;
      } catch (_) {
        ragFailed++;
      }
      await updateRagStatusIndicators();
    }
    const ragParts: string[] = [];
    if (ragCached > 0) ragParts.push(`${ragCached} cached`);
    if (ragBuilt > 0) ragParts.push(`${ragBuilt} newly built`);
    if (ragFailed > 0) ragParts.push(`${ragFailed} failed`);
    ragBubble.innerHTML = `✅ Phase 1/4 — Search index ready — ${ragParts.join(", ")}`;
  } catch (e) {
    ragBubble.innerHTML = `⚠️ Phase 1/4 — Search index build error. Continuing without RAG support.`;
  }
  scrollToBottom();

  // === Phase 2: Question Understanding (AI call) ===
  const quBubble = addMessageBubble("system", `<strong>🧠 Phase 2/4 — Analyzing research question...</strong>`);
  scrollToBottom();

  const quPrompt = settings.questionUnderstandingPrompt.replace(/\{question\}/g, userPrompt);
  try {
    questionUnderstandingDoc = await callAI(settings, [{ role: "user" as const, parts: [{ text: quPrompt }] }]);
    quBubble.innerHTML = `✅ Phase 2/4 — Question analysis complete.`;
  } catch (e: any) {
    questionUnderstandingDoc = "";
    quBubble.innerHTML = `⚠️ Phase 2/4 — Question analysis failed (${esc(e?.message || String(e))}). Continuing with direct extraction.`;
  }
  scrollToBottom();

  // Show question understanding as a collapsible section
  if (questionUnderstandingDoc) {
    const quDetailBubble = addMessageBubble("model", "");
    quDetailBubble.innerHTML = renderMd(
      `<details><summary>🧠 Question Understanding (click to expand)</summary>\n\n${questionUnderstandingDoc}\n\n</details>`
    );
    scrollToBottom();
  }

  // === Phase 3: Per-paper extraction (AI calls, with question understanding context) ===
  const perPaperPrompt = settings.extractionPrompt
    .replace(/\{question\}/g, userPrompt)
    .replace(/\{understanding\}/g, questionUnderstandingDoc || `(Question understanding not available. Please directly analyze based on the research question.)`);

  const CONCURRENCY = Math.min(settings.concurrency, allPdfs.length);
  const progressBubble = addMessageBubble("system", "");
  const extractions: string[] = new Array(allPdfs.length).fill("");
  const pStatus: ("pending" | "running" | "done" | "failed")[] = new Array(allPdfs.length).fill("pending");

  function updateProgress() {
    const doneCount = pStatus.filter(s => s === "done" || s === "failed").length;
    const runningIndices = pStatus.map((s, i) => s === "running" ? i : -1).filter(i => i >= 0);

    const modelInfo = settings.extractionModel !== settings.model
      ? `extraction: ${esc(settings.extractionModel)} → synthesis: ${esc(settings.model)}`
      : `model: ${esc(settings.model)}`;
    let prog = `<strong>📑 Phase 3/4 — Extracting (${CONCURRENCY} concurrent) — ${doneCount}/${allPdfs.length}</strong><br><div style="font-size:11px;color:#888;margin:2px 0 6px;">${modelInfo}</div>`;

    if (runningIndices.length > 0) {
      prog += `<div style="margin-bottom:6px;color:#007AFF;font-weight:500;">⏳ Processing:</div>`;
      for (const ri of runningIndices) {
        prog += `<div style="padding:2px 0 2px 12px;">• Paper ${ri + 1}: ${esc(allPdfs[ri].title)}</div>`;
      }
      prog += `<br>`;
    }

    for (let i = 0; i < allPdfs.length; i++) {
      if (pStatus[i] === "done") {
        prog += `<div style="color:#34a853;">✅ Paper ${i + 1}: ${esc(allPdfs[i].title)}</div>`;
      } else if (pStatus[i] === "failed") {
        prog += `<div style="color:#ea4335;">❌ Paper ${i + 1}: ${esc(allPdfs[i].title)}</div>`;
      }
    }

    progressBubble.innerHTML = prog;
    scrollToBottom();
  }

  async function extractOne(i: number) {
    const { pdfItem, title } = allPdfs[i];
    pStatus[i] = "running";
    updateProgress();

    const ctx: any[] = [];
    if (settings.provider === "gemini") {
      const b = await getPdfBase64(pdfItem);
      if (b) { ctx.push({ text: `[Paper: ${title}]` }); ctx.push({ inlineData: b }); }
    } else {
      const t = await getPdfText(pdfItem);
      if (t) ctx.push({ text: `[Paper: ${title}]\n\n${t}` });
    }

    if (ctx.length === 0) {
      extractions[i] = `# Paper ${i + 1}: ${title}\n\n*Failed to extract PDF content.*`;
      pStatus[i] = "failed";
      updateProgress();
      return;
    }

    try {
      const r = await callAI(settings, [{ role: "user", parts: [...ctx, { text: perPaperPrompt }] }], settings.extractionModel);
      extractions[i] = `# Paper ${i + 1}: ${title}\n\n${r}`;
      pStatus[i] = "done";
    } catch (e: any) {
      extractions[i] = `# Paper ${i + 1}: ${title}\n\n*Failed: ${e?.message || e}*`;
      pStatus[i] = "failed";
    }
    updateProgress();
  }

  const queue = allPdfs.map((_, i) => i);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < CONCURRENCY; w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const idx = queue.shift()!;
        try {
          await extractOne(idx);
        } catch (e: any) {
          extractions[idx] = `# Paper ${idx + 1}: ${allPdfs[idx].title}\n\n*Worker error: ${e?.message || e}*`;
          pStatus[idx] = "failed";
          updateProgress();
        }
        await delay(500);
      }
    })());
  }
  await Promise.all(workers);

  analysisDoc = extractions.join("\n\n---\n\n");

  chatHistory.push({ role: "user", text: userPrompt });
  await saveAnalysisNote();

  // === Phase 4: Synthesis (with question understanding context) ===
  progressBubble.innerHTML = `✅ Phase 3/4 — All ${allPdfs.length} papers extracted. Starting synthesis...`;
  scrollToBottom();

  const synthPrompt = settings.synthesisPrompt
    .replace(/\{question\}/g, userPrompt)
    .replace(/\{understanding\}/g, questionUnderstandingDoc || "(Question understanding not available.)")
    .replace(/\{count\}/g, String(allPdfs.length));

  const synthContents = [{ role: "user" as const, parts: [{ text: analysisDoc + "\n\n---\n\n" + synthPrompt }] }];

  let fullMd = `<details><summary>📋 Per-paper Extractions (click to expand)</summary>\n\n${analysisDoc}\n\n</details>\n\n---\n\n`;
  progressBubble.innerHTML = `<strong>🔬 Phase 4/4 — Synthesizing cross-paper analysis...</strong>`;
  scrollToBottom();

  const modelBubble = addMessageBubble("model", "");

  try {
    for await (const chunk of callAIStream(settings, synthContents)) {
      fullMd += chunk;
      modelBubble.innerHTML = renderMd(fullMd);
      scrollToBottom();
    }
  } catch (synthErr: any) {
    fullMd += `\n\n---\n\n⚠️ Synthesis interrupted: ${synthErr?.message || synthErr}\n\nThe per-paper extractions above are still available. You can ask a follow-up question to retry the synthesis.`;
    modelBubble.innerHTML = renderMd(fullMd);
  }

  modelBubble.innerHTML = renderMd(fullMd);
  chatHistory.push({ role: "model", text: fullMd });

  await saveAnalysisNote();
}

// ---------- Follow-up message ----------

async function handleFollowUp(userPrompt: string, settings: ReturnType<typeof getSettings>) {
  const { parts: contextParts, ragInfo } = await buildContextParts(settings, userPrompt);

  if (ragInfo) {
    addMessageBubble("system", esc(ragInfo));
    scrollToBottom();
  }

  const contents: any[] = [];
  for (const msg of chatHistory) {
    if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.text }] });
    } else if (msg.role === "model") {
      contents.push({ role: "model", parts: [{ text: msg.text }] });
    }
  }

  const wrappedPrompt = settings.followUpPrompt.replace(/\{question\}/g, userPrompt);
  const userParts: any[] = [...contextParts, { text: wrappedPrompt }];
  contents.push({ role: "user", parts: userParts });

  const modelBubble = addMessageBubble("model", "");
  let accum = "";

  for await (const chunk of callAIStream(settings, contents)) {
    accum += chunk;
    modelBubble.innerHTML = renderMd(accum);
    scrollToBottom();
  }

  modelBubble.innerHTML = renderMd(accum);
  chatHistory.push({ role: "user", text: userPrompt });
  chatHistory.push({ role: "model", text: accum });

  await saveAnalysisNote();
}

// ---------- Send handler ----------

async function handleSend() {
  if (busy) return;
  const input = $("chat-input") as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text) return;

  let settings: ReturnType<typeof getSettings>;
  try {
    ensureGlobals();
    settings = getSettings();
  } catch (e: any) {
    addMessageBubble("system", `⚠️ ${esc(e?.message || String(e))}`);
    return;
  }
  if (!settings.apiKey) {
    addMessageBubble("system", "⚠️ Missing API key. Configure in Edit → Settings → Zotero Sidebar Chat.");
    return;
  }

  input.value = "";
  input.style.height = "auto";
  addMessageBubble("user", esc(text));

  const btn = $("btn-send") as HTMLButtonElement;
  busy = true;
  btn.disabled = true;
  btn.textContent = "...";
  input.disabled = true;

  try {
    if (chatHistory.length === 0) {
      await runInitialAnalysis(text, settings);
    } else {
      await handleFollowUp(text, settings);
    }
  } catch (e: any) {
    addMessageBubble("system", `❌ ${esc(e?.message || String(e))}`);
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = "Send";
    input.disabled = false;
    input.focus();
  }
}

// ---------- Init ----------

async function updateRagStatusIndicators() {
  for (const p of papers) {
    const dot = document.querySelector(`[data-rag-id="${p.id}"]`) as HTMLElement;
    if (!dot) continue;
    let has = ragIndices.has(p.id);
    if (!has) {
      try { has = await hasRagIndex(p.id); } catch (_) { has = false; }
    }
    dot.style.background = has ? "#007AFF" : "#d1d5db";
    dot.title = has ? "RAG index ready" : "No RAG index yet";
  }
}

function getPapers(): PaperInfo[] {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("data");
    if (raw) {
      // URLSearchParams.get() already decodes once;
      // the value was encodeURIComponent'd by contextMenu, so decode again
      let decoded = raw;
      try { decoded = decodeURIComponent(raw); } catch (_) { /* already decoded */ }
      // Try parsing — if first attempt fails it's already plain JSON
      let parsed: any;
      try { parsed = JSON.parse(decoded); } catch (_) { parsed = JSON.parse(raw); }
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_e) { /* ignore */ }
  return [];
}

function init() {
  try { ensureGlobals(); } catch (_e) { /* will fail later with message */ }

  papers = getPapers();
  const list = $("paper-check-list");

  if (papers.length === 0) {
    list.innerHTML = `<div style="padding:12px;color:#86868b;font-size:12px;">No papers loaded</div>`;
  } else {
    list.innerHTML = "";
    papers.forEach((p, i) => {
      const item = document.createElement("div");
      item.className = "paper-check-item";
      item.setAttribute("data-paper-id", String(p.id));
      item.title = p.title;
      item.innerHTML = `<span class="paper-check-label">${i + 1}. ${esc(p.title)}</span><span class="rag-status-dot" data-rag-id="${p.id}"></span>`;
      list.appendChild(item);
    });
  }

  const input = $("chat-input") as HTMLTextAreaElement;
  const btn = $("btn-send") as HTMLButtonElement;

  btn.addEventListener("click", handleSend);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
  });

  if (papers.length > 0) {
    addMessageBubble("system", `${papers.length} paper(s) loaded. Type your research question to start the 4-phase analysis pipeline:\n① RAG Index → ② Question Understanding → ③ Per-paper Extraction → ④ Synthesis.\nFollow-up questions will automatically search all papers via RAG.`);
    updateRagStatusIndicators();
  }

  input.focus();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
