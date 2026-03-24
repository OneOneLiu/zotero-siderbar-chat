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
} from "./ragIndex";
import { searchChunksBalanced } from "./ragSearch";
import type { ChatContext, PaperInfo, ChatMsg } from "./chatContext";
import { createEmptyChatContext } from "./chatContext";

export type { PaperInfo, ChatMsg, ChatContext } from "./chatContext";
export { createEmptyChatContext } from "./chatContext";

// ---------- Globals resolution ----------

/** Reader sidebar / some chrome scopes have no `window`; use globalThis. */
function getGlobalRoot(): any {
  return typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : {});
}

function getLocationSearch(): string {
  try {
    const loc = (getGlobalRoot() as any).location;
    return loc && typeof loc.search === "string" ? loc.search : "";
  } catch {
    return "";
  }
}

function getZotero(): any {
  const w = getGlobalRoot() as any;
  return w.Zotero || w.parent?.Zotero || w.opener?.Zotero || w.top?.Zotero;
}
function getIOUtils(): any {
  const w = getGlobalRoot() as any;
  return w.IOUtils || w.parent?.IOUtils || w.opener?.IOUtils || w.top?.IOUtils;
}

let Zotero: any = null;
let IOUtils: any = null;

export function ensureGlobals() {
  if (!Zotero) Zotero = getZotero();
  if (!IOUtils) IOUtils = getIOUtils();
  // Expose resolved globals so ragIndex.ts (bare Zotero/IOUtils/PathUtils) sees them in this scope.
  const w = getGlobalRoot() as any;
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
    // xhtmlOut: required for Zotero reader (XHTML); plain <br> in innerHTML throws DOMException.
    md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      breaks: true,
      xhtmlOut: true,
    });
    try {
      md.use(tm, { engine: katex, delimiters: ["dollars", "brackets"], katexOptions: { output: "htmlAndMathml", throwOnError: false } });
    } catch (_e) { /* optional */ }
  }
  return md;
}

// ---------- Bound session (iframe or sidebar) ----------

let C!: ChatContext;

/** Call before any core operation; sidebar passes per-tab context, iframe passes its singleton. */
export function bindChatContext(ctx: ChatContext) {
  C = ctx;
}

bindChatContext(createEmptyChatContext());

// ---------- Settings ----------

export function getFullAnalysisSettings() {
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

## Context: 待分析论文集

用户准备基于以下 {count} 篇论文来回答研究问题。后续流程会逐篇将论文原文发送给你进行信息提取，当前阶段你只需了解论文的基本元信息，以便更有针对性地拆解问题。

"""
{paper_list}
"""

## Task: 问题解构与概念澄清

用户提出了以下研究问题：
"""
{question}
"""

请结合上述论文集的研究方向和领域，严格按照以下步骤对该问题进行深度解析：

### 1. 核心意图分析
判断该问题的类型（概念类「是什么」/ 动机类「为什么」/ 存在类「有没有」/ 对比类「有何区别」/ 复合类），提取清晰、客观的核心诉求，理解用户真正想要知道什么。

### 2. 关键词提取与概念界定
- 提取所有核心关键词，逐一澄清和辨析，消除一切歧义。
- 尽可能使用清晰的自然语言表述概念，能定量的必须定量（尤其是形容词或修饰性名词）。技术概念能用数学思想表述的必须用数学思想表述。
- 检查提问中使用的词汇是否为标准学术概念。若发现非标准用词，必须指出并提供标准学术术语。
- 对模糊概念给出一个无歧义的工作定义，作为后续分析的基准（兜底定义机制）。
- 结合论文集的研究方向，判断关键词在该领域中的具体含义。

### 3. 衍生问题拆解
采用"打破砂锅问到底"的原则追根溯源，罗列出一系列与问题来龙去脉相关的基本或衍生子问题：
- 必须包含至少一个概念性子问题："什么是[X]？领域对它是否有清晰无歧义的定义？"
- 必须包含至少一个动机性子问题："为什么要[X]？"
- 其他帮助回答总问题的原子化子问题
- 每个子问题应尽量短，不涉及过多概念，确保是基本的原子问题
- 这些子问题必须能构成一条清晰的回答脉络
- 对每个子问题编号（Q1, Q2, Q3...），后续各阶段将统一引用这些编号

### 4. 问题理解总结
将以上分析凝练为一段结构化总结，严格使用如下格式：
> "用户提出了一个关于[xxx]的问题。核心关键词包括：1.[xxx] 2.[xxx]...。其中[xxx]是无歧义的专业学术术语，[xxx]可能存在歧义需要澄清，消除歧义后的工作定义为[xxx]。综合分析，用户的核心目的是[xxx]。为全面、透彻地回答此问题，需要逐一解答以下子问题：Q1.[xxx] Q2.[xxx]..."

请使用与用户问题相同的语言输出。`;

  const defaultExtractionPrompt = `# Role: 学术文献信息萃取专家

你是一个精通文献信息提取和相关性判定的AI专家。你的所有分析必须百分之百基于文献原文，拒绝任何形式的幻觉和无端发散。

## Context: 问题理解

以下是对用户研究问题的深度分析（包含编号子问题 Q1, Q2, Q3...）：
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

### Part B: 子问题逐一回答
逐一检查问题理解中的每个子问题（Q1, Q2, Q3...），基于该论文原文内容给出回答：
- **若该论文包含相关信息**：给出基于本文的初步回答，引用具体内容作为证据，注意概念定义的定量一致性
- **若该论文未涉及该子问题**：标注"本文未涉及"
- 格式要求：按 Q1, Q2, Q3... 的编号逐一回答，确保与问题理解中的编号对应

### Part C: 相关性综合判定
基于 Part A 和 Part B 的分析结果，对该文献做出整体相关性判定：
- **高度相关**：能回答多个子问题，核心内容与研究问题直接对应
- **部分相关**：仅涉及部分子问题或提供间接支撑
- **不相关**：与研究问题基本无关，建议用户从分析集中剔除该文献，并给出理由

### Part D: 关键信息凝练
将提取的核心内容及子问题回答要点凝练成一段简短总结备用。

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

## Context: 各篇论文的结构化信息提取结果（共 {count} 篇）

以下是通过 Per-paper Extraction 阶段从每篇论文中独立提取的结构化信息。每篇包含核心要素提取（研究问题、贡献、方法、结果、局限性）和与研究问题的相关性分析。

"""
{extractions}
"""

## Task: 多文献交叉比对与综合分析

基于以上各篇论文的提取结果，请严格按照以下步骤进行交叉分析和输出：

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

  const ALL_TOOL_NAMES = [
    "load_paper_fulltext", "rag_deep_search", "get_paper_metadata",
    "get_item_notes", "get_item_annotations",
    "list_collections", "list_collection_items", "search_library",
    "get_items_by_tag", "list_tags",
    "get_item_collections", "get_related_items", "get_item_details",
    "get_collection_tag_stats", "get_collection_stats", "get_recent_items",
    "remove_paper", "add_paper_to_analysis", "rebuild_paper_rag",
    "add_tag", "remove_tag",
  ];
  let enabledTools: Set<string>;
  try {
    const raw = Z.Prefs.get(`${pfx}.enabledTools`, true) as string;
    if (raw) {
      const saved = new Set(JSON.parse(raw) as string[]);
      for (const t of ALL_TOOL_NAMES) { if (!saved.has(t)) saved.add(t); }
      enabledTools = saved;
    } else {
      enabledTools = new Set(ALL_TOOL_NAMES);
    }
  } catch {
    enabledTools = new Set(ALL_TOOL_NAMES);
  }

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
    enabledTools,
    maxToolRounds: Math.max(1, Math.min(200, parseInt((Z.Prefs.get(`${pfx}.maxToolRounds`, true) as string) || "100", 10) || 100)),
    userPreferences: (() => {
      try {
        const raw = Z.Prefs.get(`${pfx}.userPreferences`, true) as string;
        return raw ? (JSON.parse(raw) as UserPreference[]) : [];
      } catch { return []; }
    })(),
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
  if (C.ragIndices.has(paperId)) return C.ragIndices.get(paperId)!;

  let idx = await loadRagIndex(paperId);
  if (idx) {
    C.ragIndices.set(paperId, idx);
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
  idx = await buildRagIndexFromText(paperId, title, text);
  await saveRagIndex(idx);
  C.ragIndices.set(paperId, idx);
  return idx;
}

async function buildRagIndicesForPapers(paperIds: number[], onProgress?: (done: number, total: number, title: string) => void): Promise<void> {
  await ensureRagDir();
  for (let i = 0; i < paperIds.length; i++) {
    const pid = paperIds[i];
    const p = C.papers.find(pp => pp.id === pid);
    if (onProgress) onProgress(i, paperIds.length, p?.title || "");
    await ensureRagForPaper(pid);
  }
  if (onProgress) onProgress(paperIds.length, paperIds.length, "");
}

// ---------- AI helpers ----------

function buildEndpoint(s: ReturnType<typeof getFullAnalysisSettings>, stream: boolean, modelOverride?: string) {
  const model = modelOverride || s.model;
  if (s.provider === "gemini") return `${s.apiBase}/models/${model}:${stream ? "streamGenerateContent" : "generateContent"}?key=${s.apiKey}`;
  return `${s.apiBase}/chat/completions`;
}

function formatPayload(s: ReturnType<typeof getFullAnalysisSettings>, contents: any[], stream: boolean, modelOverride?: string) {
  if (s.provider === "gemini") return { contents };
  const model = modelOverride || s.model;
  const msgs = contents.map(c => ({
    role: c.role === "model" ? "assistant" : c.role,
    content: c.parts.filter((p: any) => p.text).map((p: any) => p.text).join("\n"),
  }));
  return { model, messages: msgs, stream };
}

function buildHeaders(s: ReturnType<typeof getFullAnalysisSettings>) {
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

async function callAI(s: ReturnType<typeof getFullAnalysisSettings>, contents: any[], modelOverride?: string): Promise<string> {
  const res = await fetchWithRetry(buildEndpoint(s, false, modelOverride), { method: "POST", headers: buildHeaders(s), body: JSON.stringify(formatPayload(s, contents, false, modelOverride)) });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const j: any = await res.json();
  if (s.provider === "gemini") {
    if (j?.error?.message) throw new Error(`API Error: ${j.error.message}`);
    const c = j?.candidates || j?.[0]?.candidates;
    if (c?.[0]?.content?.parts?.[0]?.text !== undefined) return c[0].content.parts[0].text;
    if (Array.isArray(j)) { let f = ""; for (const x of j) { const t = x?.candidates?.[0]?.content?.parts?.[0]?.text; if (t) f += t; } if (f) return f; }
    throw new Error(`Unexpected Gemini response: ${JSON.stringify(j)}`);
  }
  
  if (j?.error?.message) throw new Error(`API Error: ${j.error.message}`);
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  
  throw new Error(`Unexpected response: ${JSON.stringify(j)}`);
}

async function* callAIStream(s: ReturnType<typeof getFullAnalysisSettings>, contents: any[], modelOverride?: string): AsyncGenerator<string> {
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

// ---------- RAG query rewriting ----------

const HAS_NON_LATIN_RE = /[^\u0000-\u024F\u1E00-\u1EFF]/;

async function rewriteQueryForSearch(settings: ReturnType<typeof getFullAnalysisSettings>, userQuery: string): Promise<string> {
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

async function buildContextParts(settings: ReturnType<typeof getFullAnalysisSettings>, userQuery: string): Promise<{ parts: any[]; ragInfo: string }> {
  const checkedIds = C.papers.map(p => p.id);
  const parts: any[] = [];
  let ragInfo = "";

  if (C.questionUnderstandingDoc) {
    parts.push({ text: `[Question Understanding]\n\n${C.questionUnderstandingDoc}` });
  }

  if (C.analysisDoc) {
    parts.push({ text: `[Previous Analysis Summary]\n\n${C.analysisDoc}` });
  }

  if (checkedIds.length > 0 && userQuery) {
    const indices: RagIndex[] = [];
    for (const pid of checkedIds) {
      const idx = C.ragIndices.get(pid) || await ensureRagForPaper(pid);
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
  C.papers.forEach((p, i) => {
    md += `## Paper ${i + 1}\n\n`;
    const meta = getPaperMetadata(p.id);
    md += meta ? meta + "\n\n" : `**${esc(p.title)}**\n\n`;
  });
  return md;
}

function getSessionTimestamp(): string {
  if (!C.sessionCreatedAt) {
    const d = new Date();
    C.sessionCreatedAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return C.sessionCreatedAt;
}

function buildSessionJson(): string {
  const session = {
    version: 1,
    createdAt: getSessionTimestamp(),
    savedAt: new Date().toISOString(),
    standaloneMode: C.standaloneMode,
    standaloneCollectionInfo: C.standaloneCollectionInfo,
    papers: C.papers,
    chatHistory: C.chatHistory,
    questionUnderstandingDoc: C.questionUnderstandingDoc,
    analysisDoc: C.analysisDoc,
  };
  return JSON.stringify(session);
}

/**
 * One dataset per library titled "Research Copilot History". All session JSON attachments
 * are children of this item. Collection is only used when creating a new dataset (optional
 * placement); we never create a second dataset just because the canonical one lives elsewhere.
 */
async function getOrCreateHistoryDataset(libraryID: number, collectionId?: number): Promise<number | undefined> {
  try {
    const s = new Zotero.Search();
    s.libraryID = libraryID;
    s.addCondition("itemType", "is", "dataset");
    s.addCondition("title", "is", "Research Copilot History");

    const results = await s.search();

    if (results && results.length > 0) {
      for (const id of results) {
        const item = Zotero.Items.get(id);
        if (item && !item.deleted) return id;
      }
    }

    const dataset = new Zotero.Item("dataset");
    dataset.libraryID = libraryID;
    dataset.setField("title", "Research Copilot History");
    await dataset.saveTx();

    if (collectionId) {
      dataset.addToCollection(collectionId);
      await dataset.saveTx();
    }
    return dataset.id;
  } catch (e) {
    Zotero.debug("[ResearchCopilot] getOrCreateHistoryDataset failed: " + e);
    return undefined;
  }
}

export async function saveAnalysisNote() {
  if (analysisMessagesHost) return;
  try {
    let note: any;
    if (C.savedNoteId) {
      try {
        const existing = Zotero.Items.get(C.savedNoteId);
        if (existing && !existing.deleted && existing.isNote()) note = existing;
      } catch (_) { /* ignore */ }
    }

    if (!note) {
      note = new Zotero.Item("note");
      note.libraryID = Zotero.Libraries.userLibraryID;
    }

    const paperInfoHtml = renderMdForNote(buildPaperInfoSection());

    let quHtml = "";
    if (C.questionUnderstandingDoc) {
      quHtml = `<h1>Question Understanding</h1>${renderMdForNote(C.questionUnderstandingDoc)}`;
    }

    let extractionsHtml = "";
    if (C.analysisDoc) {
      extractionsHtml = `<h1>Per-paper Extractions</h1>${renderMdForNote(C.analysisDoc)}`;
    }

    let chatHtml = "<h1>Chat History</h1>";
    let turnNum = 0;
    for (let i = 0; i < C.chatHistory.length; i++) {
      const msg = C.chatHistory[i];
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

    const ts = getSessionTimestamp();
    const firstQ = C.chatHistory.find(m => m.role === "user")?.text || "";
    const topicHint = firstQ.length > 30 ? firstQ.slice(0, 30) + "…" : firstQ;
    const titleSuffix = topicHint ? ` — ${esc(topicHint)}` : "";

    const sessionJson = buildSessionJson();
    let sessionBlock = "";
    let linkHtml = "";
    
    const niceName = `Analysis_${ts}${titleSuffix}`.replace(/[\\/:*?"<>|\r\n]/g, "_").substring(0, 100);

    try {
      let attItem: any;
      if (C.savedAttachmentId) {
        const existing = Zotero.Items.get(C.savedAttachmentId);
        if (existing && !existing.deleted && existing.isAttachment()) {
          attItem = existing;
        }
      }

      if (!attItem) {
        const tmpFile = PathUtils.join(PathUtils.tempDir, `${niceName}.json`);
        await IOUtils.writeUTF8(tmpFile, sessionJson);

        let targetCollectionId = C.standaloneCollectionInfo?.id;
        if (!targetCollectionId && note.parentID) {
          const parent = Zotero.Items.get(note.parentID);
          if (parent) {
            const colls = parent.getCollections();
            if (colls.length > 0) targetCollectionId = colls[0];
          }
        }
        if (!targetCollectionId && C.papers.length > 0) {
          const firstPaper = Zotero.Items.get(C.papers[0].id);
          if (firstPaper) {
            const colls = firstPaper.getCollections();
            if (colls.length > 0) targetCollectionId = colls[0];
          }
        }

        const parentDatasetId = await getOrCreateHistoryDataset(note.libraryID, targetCollectionId);

        attItem = await Zotero.Attachments.importFromFile({
          file: tmpFile,
          libraryID: note.libraryID,
          parentItemID: parentDatasetId
        });
        
        attItem.setField("title", `Session Data: ${niceName}`);
        await attItem.saveTx();

        C.savedAttachmentId = attItem.id;
      } else {
        const path = await attItem.getFilePathAsync();
        if (path) await IOUtils.writeUTF8(path, sessionJson);
        
        if (attItem.getField("title") !== `Session Data: ${niceName}`) {
          attItem.setField("title", `Session Data: ${niceName}`);
          await attItem.saveTx();
        }
      }
      
      const attKey = attItem.key ? String(attItem.key).toUpperCase() : "";
      sessionBlock = attKey
        ? `<div data-analysis-attachment-lkh="${note.libraryID}_${attKey}" style="display:none"></div>\n`
        : "";
      sessionBlock += `<div data-analysis-attachment-id="${attItem.id}" style="display:none"></div>`;
      sessionBlock += `\n<span class="research-copilot-session-id" style="display:none;">ResearchCopilotSessionID:${attItem.id}</span>`;
      if (attKey) {
        linkHtml = ` · <strong><a href="zotero://select/items/${note.libraryID}_${attKey}">[View Session JSON]</a></strong>`;
      }
    } catch (e) {
      Zotero.debug("[ResearchCopilot] Fallback to embedded HTML session block due to attachment error: " + e);
      sessionBlock = `<div data-analysis-session style="display:none">${esc(sessionJson)}</div>`;
    }

    const savedAt = new Date().toLocaleString();
    const html = `<h1>📊 Analysis [${ts}]${titleSuffix}</h1>
<p><em>Saved: ${savedAt} · ${C.papers.length} paper(s) · ${C.chatHistory.filter(m => m.role === "user").length} question(s)${linkHtml}</em></p>
${sessionBlock}
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

    if (!C.savedNoteId && !note.parentID && C.standaloneCollectionInfo.id) {
      try {
        note.addToCollection(C.standaloneCollectionInfo.id);
        await note.saveTx();
      } catch {
        try {
          const coll = Zotero.Collections.get(C.standaloneCollectionInfo.id);
          if (coll) { coll.addItem(note.id); await coll.saveTx(); }
        } catch {}
      }
    }

    C.savedNoteId = note.id;
  } catch (_e) { /* save is non-critical */ }
}

// ---------- DOM helpers (iframe IDs or reader sidebar hosts) ----------

let analysisMessagesHost: HTMLElement | null = null;
let analysisPaperListHost: HTMLElement | null = null;
/** When set, chat bubbles append here (e.g. reader `.gemini-chat-messages`) instead of `#chat-messages`. */
export function setAnalysisDOMHosts(hosts: { messages?: HTMLElement | null; paperList?: HTMLElement | null } | null) {
  analysisMessagesHost = hosts?.messages ?? null;
  analysisPaperListHost = hosts?.paperList ?? null;
}

/** Reader sidebar often has no global `document`; use chat host's ownerDocument when set. */
function getRootDocument(): Document | null {
  try {
    if (analysisMessagesHost?.ownerDocument) return analysisMessagesHost.ownerDocument;
    if (analysisPaperListHost?.ownerDocument) return analysisPaperListHost.ownerDocument;
    const d = (getGlobalRoot() as any).document;
    if (d && typeof d.getElementById === "function") return d;
  } catch { /* ignore */ }
  return null;
}

function $(id: string): HTMLElement {
  if (id === "chat-messages" && analysisMessagesHost) return analysisMessagesHost;
  if (id === "paper-check-list" && analysisPaperListHost) return analysisPaperListHost;
  const doc = getRootDocument();
  if (!doc) throw new Error(`Missing document for #${id}`);
  const el = doc.getElementById(id);
  if (el) return el;
  if (id === "paper-check-list") {
    const h = doc.createElement("div");
    h.id = id;
    h.style.display = "none";
    doc.body?.appendChild(h);
    return h;
  }
  throw new Error(`Missing required element #${id}`);
}

function isNearBottom(): boolean {
  const el = analysisMessagesHost || getRootDocument()?.getElementById("chat-messages") || null;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollToBottom(force = false) {
  if (!force && !isNearBottom()) return;
  const el = analysisMessagesHost || getRootDocument()?.getElementById("chat-messages") || null;
  if (el) el.scrollTop = el.scrollHeight;
}

/**
 * Zotero PDF reader sidebar uses an XML document; assigning HTML with void tags like `<br>`
 * to innerHTML throws "An invalid or illegal string was specified".
 */
function setChatInnerHTML(el: HTMLElement, html: string) {
  if (!html) {
    el.textContent = "";
    return;
  }
  try {
    el.innerHTML = html;
    return;
  } catch {
    /* strict XML */
  }
  try {
    const win = (el.ownerDocument?.defaultView || getGlobalRoot()) as Window | undefined;
    const Parser = win?.DOMParser;
    if (Parser) {
      const parsed = new Parser().parseFromString(html, "text/html");
      const body = parsed.body;
      el.textContent = "";
      const targetDoc = el.ownerDocument;
      for (const node of Array.from(body.childNodes) as Node[]) {
        el.appendChild(targetDoc.importNode(node, true));
      }
      return;
    }
  } catch {
    /* ignore */
  }
  el.textContent = html.replace(/<[^>]*>/g, " ");
}

function addMessageBubble(role: "user" | "model" | "system", html: string): HTMLElement {
  const host = $("chat-messages");
  const doc = host.ownerDocument || getRootDocument();
  if (!doc) throw new Error("No DOM document for chat bubbles");
  const el = doc.createElement("div");
  el.className = analysisMessagesHost ? `gemini-chat-bubble ${role}` : `msg ${role}`;
  setChatInnerHTML(el, html);
  host.appendChild(el);
  scrollToBottom(true);
  return el;
}

function normalizeMathDelimiters(src: string): string {
  src = src.replace(/```(?:latex|math|tex)?\s*\n([\s\S]*?)```/g, (_m, p1) => `$$${p1.trim()}$$`);
  src = src.replace(/\\\[([\s\S]*?)\\\]/g, (_m, p1) => `$$${p1}$$`);
  src = src.replace(/\\\((.+?)\\\)/g, (_m, p1) => `$${p1}$`);
  return src;
}

function renderMd(text: string): string {
  try { return getMarkdown().render(normalizeMathDelimiters(text)); } catch (_) { return esc(text); }
}

let mdForNote: any = null;
function getMarkdownForNote() {
  if (!mdForNote) {
    mdForNote = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      breaks: true,
      xhtmlOut: true,
    });
    // Deliberately omitted mdForNote.use(tm, ...) so that notes retain raw $$ LaTeX for native plain reading and Zotero plugin parsing.
  }
  return mdForNote;
}

export function initMathCopyListener(container: HTMLElement) {
  container.addEventListener("mouseover", (e) => {
    const target = e.target as HTMLElement;
    if (!target) return;
    const mathSpan = target.closest(".katex-display, .katex") as HTMLElement | null;
    if (mathSpan && !mathSpan.querySelector(".copy-math-btn")) {
      const annotation = mathSpan.querySelector("annotation[encoding='application/x-tex']");
      if (annotation && annotation.textContent) {
        const tex = annotation.textContent;
        const btn = container.ownerDocument.createElement("button");
        btn.className = "copy-math-btn";
        btn.textContent = "Copy LaTeX";
        btn.title = "Copy LaTeX source code";
        btn.onclick = async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          try {
            if (navigator?.clipboard?.writeText) {
              await navigator.clipboard.writeText(tex);
            } else {
              const ZoteroContext = typeof Zotero !== "undefined" ? Zotero : null;
              if (ZoteroContext) {
                const cb = Components.classes["@mozilla.org/widget/clipboardhelper;1"].getService(Components.interfaces.nsIClipboardHelper);
                cb.copyString(tex);
              }
            }
            const orig = btn.textContent;
            btn.textContent = "Copied!";
            setTimeout(() => { btn.textContent = orig; }, 1500);
          } catch (e) {
            Zotero.debug("[ResearchCopilot] Math copy failed: " + e);
          }
        };
        mathSpan.appendChild(btn);
      }
    }
  });
}

function renderMdForNote(text: string): string {
  try { return getMarkdownForNote().render(normalizeMathDelimiters(text)); } catch (_) { return esc(text); }
}

export function esc(t: string) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

const MATH_FORMAT_INSTRUCTION = "Formatting rule: When writing mathematical formulas, always use $...$ for inline math and $$...$$ (on its own line) for display math. Never wrap formulas in code blocks (backticks). This is critical for correct rendering.";

// ---------- First-message: full analysis pipeline ----------

export async function runInitialAnalysis(userPrompt: string, settings: ReturnType<typeof getFullAnalysisSettings>, isRerun = false) {
  const allPdfs: { pdfItem: any; title: string }[] = [];
  for (const p of C.papers) {
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
    for (let i = 0; i < C.papers.length; i++) {
      const p = C.papers[i];
      const alreadyReady = C.ragIndices.has(p.id) || await hasRagIndex(p.id);
      setChatInnerHTML(ragBubble, `<strong>🔍 Phase 1/4 — Preparing search index — ${i + 1}/${C.papers.length}</strong><br />` +
        (alreadyReady ? `📦 Loading: ${esc(p.title)}` : `🔨 Building: ${esc(p.title)}`));
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
    setChatInnerHTML(ragBubble, `✅ Phase 1/4 — Search index ready — ${ragParts.join(", ")}`);
  } catch (e) {
    setChatInnerHTML(ragBubble, `⚠️ Phase 1/4 — Search index build error. Continuing without RAG support.`);
  }
  scrollToBottom();

  // === Phase 2: Question Understanding (AI call, with paper metadata) ===
  const quBubble = addMessageBubble("system", `<strong>🧠 Phase 2/4 — Analyzing research question...</strong>`);
  scrollToBottom();

  const paperMetaList = buildPaperInfoSection();
  const quPrompt = settings.questionUnderstandingPrompt
    .replace(/\{question\}/g, userPrompt)
    .replace(/\{paper_list\}/g, paperMetaList)
    .replace(/\{count\}/g, String(allPdfs.length));
  try {
    // On rerun, include previous chat history as context
    const quContents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
    if (isRerun && C.chatHistory.length > 0) {
      for (const msg of C.chatHistory) {
        if (msg.role === "user" || msg.role === "model") {
          quContents.push({ role: msg.role, parts: [{ text: msg.text }] });
        }
      }
    }
    quContents.push({ role: "user" as const, parts: [{ text: quPrompt + "\n\n" + MATH_FORMAT_INSTRUCTION }] });
    C.questionUnderstandingDoc = await callAI(settings, quContents);
    setChatInnerHTML(quBubble, `✅ Phase 2/4 — Question analysis complete.`);
  } catch (e: any) {
    C.questionUnderstandingDoc = "";
    setChatInnerHTML(quBubble, `⚠️ Phase 2/4 — Question analysis failed (${esc(e?.message || String(e))}). Continuing with direct extraction.`);
  }
  scrollToBottom();

  // Show question understanding as a collapsible section
  if (C.questionUnderstandingDoc) {
    const quDetailBubble = addMessageBubble("model", "");
    setChatInnerHTML(quDetailBubble, renderMd(
      `<details><summary>🧠 Question Understanding (click to expand)</summary>\n\n${C.questionUnderstandingDoc}\n\n</details>`
    ));
    scrollToBottom();
  }

  // === Phase 3: Per-paper extraction (AI calls, with question understanding context) ===
  const perPaperPrompt = settings.extractionPrompt
    .replace(/\{question\}/g, userPrompt)
    .replace(/\{understanding\}/g, C.questionUnderstandingDoc || `(Question understanding not available. Please directly analyze based on the research question.)`);

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
    let prog = `<strong>📑 Phase 3/4 — Extracting (${CONCURRENCY} concurrent) — ${doneCount}/${allPdfs.length}</strong><br /><div style="font-size:11px;color:#888;margin:2px 0 6px;">${modelInfo}</div>`;

    if (runningIndices.length > 0) {
      prog += `<div style="margin-bottom:6px;color:#007AFF;font-weight:500;">⏳ Processing:</div>`;
      for (const ri of runningIndices) {
        prog += `<div style="padding:2px 0 2px 12px;">• Paper ${ri + 1}: ${esc(allPdfs[ri].title)}</div>`;
      }
      prog += `<br />`;
    }

    for (let i = 0; i < allPdfs.length; i++) {
      if (pStatus[i] === "done") {
        prog += `<div style="color:#34a853;">✅ Paper ${i + 1}: ${esc(allPdfs[i].title)}</div>`;
      } else if (pStatus[i] === "failed") {
        prog += `<div style="color:#ea4335;">❌ Paper ${i + 1}: ${esc(allPdfs[i].title)}</div>`;
      }
    }

    setChatInnerHTML(progressBubble, prog);
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
      const r = await callAI(settings, [{ role: "user", parts: [...ctx, { text: perPaperPrompt + "\n\n" + MATH_FORMAT_INSTRUCTION }] }], settings.extractionModel);
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

  C.analysisDoc = extractions.join("\n\n---\n\n");

  C.chatHistory.push({ role: "user", text: userPrompt });
  await saveAnalysisNote();

  // === Phase 4: Synthesis (with question understanding context) ===
  setChatInnerHTML(progressBubble, `✅ Phase 3/4 — All ${allPdfs.length} papers extracted. Starting synthesis...`);
  scrollToBottom();

  const synthPrompt = settings.synthesisPrompt
    .replace(/\{question\}/g, userPrompt)
    .replace(/\{understanding\}/g, C.questionUnderstandingDoc || "(Question understanding not available.)")
    .replace(/\{extractions\}/g, C.analysisDoc || "(No extraction results available.)")
    .replace(/\{count\}/g, String(allPdfs.length));

  const synthContents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  if (isRerun && C.chatHistory.length > 0) {
    for (const msg of C.chatHistory) {
      if (msg.role === "user" || msg.role === "model") {
        synthContents.push({ role: msg.role, parts: [{ text: msg.text }] });
      }
    }
  }
  synthContents.push({ role: "user" as const, parts: [{ text: synthPrompt + "\n\n" + MATH_FORMAT_INSTRUCTION }] });

  let fullMd = `<details><summary>📋 Per-paper Extractions (click to expand)</summary>\n\n${C.analysisDoc}\n\n</details>\n\n---\n\n`;
  setChatInnerHTML(progressBubble, `<strong>🔬 Phase 4/4 — Synthesizing cross-paper analysis...</strong>`);
  scrollToBottom();

  const modelBubble = addMessageBubble("model", "");

  try {
    for await (const chunk of callAIStream(settings, synthContents)) {
      fullMd += chunk;
      setChatInnerHTML(modelBubble, renderMd(fullMd));
      scrollToBottom();
    }
  } catch (synthErr: any) {
    fullMd += `\n\n---\n\n⚠️ Synthesis interrupted: ${synthErr?.message || synthErr}\n\nThe per-paper extractions above are still available. You can ask a follow-up question to retry the synthesis.`;
    setChatInnerHTML(modelBubble, renderMd(fullMd));
  }

  setChatInnerHTML(modelBubble, renderMd(fullMd));
  C.chatHistory.push({ role: "model", text: fullMd });

  await saveAnalysisNote();
}

// ---------- Tool Use (Function Calling) ----------

interface UserPreference {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

interface ToolDef {
  name: string;
  description: string;
  parameters: { type: string; properties: Record<string, any>; required: string[] };
}

interface ToolCall {
  name: string;
  args: Record<string, any>;
  id: string;
}

const FULLTEXT_MAX_CHARS = 80000;

function formatZoteroItemSummary(item: any): string {
  try {
    const parent = item.isAttachment?.() ? item.parentItem : item;
    const it = parent || item;
    const title = it.getField?.("title") || "(untitled)";
    const year = it.getField?.("date")?.match(/\d{4}/)?.[0] || "";
    const creators = it.getCreators?.() || [];
    const first = creators[0] ? (creators[0].lastName || creators[0].name || "?") : "";
    const authorStr = first ? (creators.length > 1 ? `${first} et al.` : first) : "Unknown";
    const journal = it.getField?.("publicationTitle") || "";
    const type = Zotero.ItemTypes?.getName?.(it.itemTypeID) || "";
    let line = `[ID:${it.id}] ${authorStr} (${year || "?"}) "${title}"`;
    if (journal) line += ` — ${journal}`;
    if (type) line += ` [${type}]`;
    return line;
  } catch {
    return `[ID:${item?.id || "?"}] (unreadable)`;
  }
}

function getToolDefs(): ToolDef[] {
  return [
    { name: "load_paper_fulltext", description: "Load full text of a paper", parameters: { type: "object", properties: { paper_index: { type: "number" } }, required: ["paper_index"] } },
    { name: "rag_deep_search", description: "Keyword search in papers", parameters: { type: "object", properties: { query: { type: "string" }, paper_index: { type: "number" } }, required: ["query"] } },
    { name: "get_paper_metadata", description: "Get paper metadata", parameters: { type: "object", properties: { paper_index: { type: "number" } }, required: ["paper_index"] } },
    { name: "get_item_notes", description: "Get notes on a paper", parameters: { type: "object", properties: { paper_index: { type: "number" } }, required: ["paper_index"] } },
    { name: "get_item_annotations", description: "Get PDF annotations", parameters: { type: "object", properties: { paper_index: { type: "number" } }, required: ["paper_index"] } },
    { name: "list_collections", description: "List Zotero collections", parameters: { type: "object", properties: {}, required: [] } },
    { name: "list_collection_items", description: "List items in a collection", parameters: { type: "object", properties: { collection_id: { type: "number" }, collection_name: { type: "string" } }, required: [] } },
    { name: "search_library", description: "Search Zotero library", parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
    { name: "get_items_by_tag", description: "Find items by tag", parameters: { type: "object", properties: { tag: { type: "string" } }, required: ["tag"] } },
    { name: "list_tags", description: "List all tags", parameters: { type: "object", properties: { filter: { type: "string" } }, required: [] } },
    { name: "get_item_collections", description: "Which collections a paper belongs to", parameters: { type: "object", properties: { paper_index: { type: "number" } }, required: ["paper_index"] } },
    { name: "get_related_items", description: "Get Zotero related items for a paper", parameters: { type: "object", properties: { paper_index: { type: "number" } }, required: ["paper_index"] } },
    { name: "get_item_details", description: "Get full metadata of any Zotero item by ID", parameters: { type: "object", properties: { item_id: { type: "number" } }, required: ["item_id"] } },
    { name: "get_collection_tag_stats", description: "Tag frequency stats for a collection (SQL)", parameters: { type: "object", properties: { collection_id: { type: "number" }, collection_name: { type: "string" }, limit: { type: "number" } }, required: [] } },
    { name: "get_collection_stats", description: "Summary stats for a collection (year dist, top authors, types)", parameters: { type: "object", properties: { collection_id: { type: "number" }, collection_name: { type: "string" } }, required: [] } },
    { name: "get_recent_items", description: "Recently added items in library", parameters: { type: "object", properties: { days: { type: "number" }, limit: { type: "number" } }, required: [] } },
    { name: "remove_paper", description: "Remove paper from analysis", parameters: { type: "object", properties: { paper_index: { type: "number" } }, required: ["paper_index"] } },
    { name: "add_paper_to_analysis", description: "Add item to analysis by ID", parameters: { type: "object", properties: { item_id: { type: "number" } }, required: ["item_id"] } },
    { name: "rebuild_paper_rag", description: "Rebuild RAG index", parameters: { type: "object", properties: { paper_index: { type: "number" } }, required: ["paper_index"] } },
    { name: "add_tag", description: "Add a tag to a paper in the analysis set or any Zotero item by ID", parameters: { type: "object", properties: { tag: { type: "string" }, paper_index: { type: "number" }, item_id: { type: "number" } }, required: ["tag"] } },
    { name: "remove_tag", description: "Remove a tag from a paper in the analysis set or any Zotero item by ID", parameters: { type: "object", properties: { tag: { type: "string" }, paper_index: { type: "number" }, item_id: { type: "number" } }, required: ["tag"] } },
  ];
}

function getPreferenceToolDefs(settings: ReturnType<typeof getFullAnalysisSettings>): ToolDef[] {
  return settings.userPreferences.map(pref => ({
    name: `pref_${pref.id}`,
    description: pref.description,
    parameters: { type: "object", properties: {}, required: [] },
  }));
}

function buildToolContextPrompt(tools: ToolDef[], settings: ReturnType<typeof getFullAnalysisSettings>): string {
  const enabled = new Set(tools.map(t => t.name));

  let ctx = `## Available Tools\n`;
  if (C.papers.length > 0) {
    const paperLines = C.papers.map((p, i) => `  ${i + 1}. "${p.title}"`).join("\n");
    ctx += `Analysis papers (paper_index is 1-based):\n${paperLines}\n\n`;
  } else {
    ctx += `No papers loaded yet. Use search_library, list_collection_items, etc. to find papers, then add_paper_to_analysis to load them.\n\n`;
  }

  const analysisTools: string[] = [];
  const libraryTools: string[] = [];
  const mgmtTools: string[] = [];

  if (enabled.has("load_paper_fulltext")) analysisTools.push("load_paper_fulltext(paper_index) — load paper full text for detailed reading");
  if (enabled.has("rag_deep_search")) analysisTools.push("rag_deep_search(query, paper_index?) — keyword search in papers, omit paper_index to search all");
  if (enabled.has("get_paper_metadata")) analysisTools.push("get_paper_metadata(paper_index) — authors, year, journal, DOI, abstract");
  if (enabled.has("get_item_notes")) analysisTools.push("get_item_notes(paper_index) — user-created notes attached to paper");
  if (enabled.has("get_item_annotations")) analysisTools.push("get_item_annotations(paper_index) — PDF highlights and annotations with page numbers");

  if (enabled.has("get_item_collections")) analysisTools.push("get_item_collections(paper_index) — which collections this paper belongs to, with full path");
  if (enabled.has("get_related_items")) analysisTools.push("get_related_items(paper_index) — Zotero-linked related items");

  if (enabled.has("list_collections")) libraryTools.push("list_collections() — list Zotero collection hierarchy");
  if (enabled.has("list_collection_items")) libraryTools.push("list_collection_items(collection_id or collection_name) — list items in a collection");
  if (enabled.has("search_library")) libraryTools.push("search_library(query, limit?) — search library by title/author/year");
  if (enabled.has("get_items_by_tag")) libraryTools.push("get_items_by_tag(tag) — find items by exact tag name");
  if (enabled.has("list_tags")) libraryTools.push("list_tags(filter?) — list all tags with item counts, optionally filtered");
  if (enabled.has("get_item_details")) libraryTools.push("get_item_details(item_id) — full metadata, tags, collections for any Zotero item by ID");
  if (enabled.has("get_collection_tag_stats")) libraryTools.push("get_collection_tag_stats(collection_id?, collection_name?, limit?) — tag frequency in a collection (SQL, fast)");
  if (enabled.has("get_collection_stats")) libraryTools.push("get_collection_stats(collection_id?, collection_name?) — summary: year dist, top authors, item types, top tags");
  if (enabled.has("get_recent_items")) libraryTools.push("get_recent_items(days?, limit?) — recently added items (default: last 7 days)");

  if (enabled.has("remove_paper")) mgmtTools.push("remove_paper(paper_index) — remove paper from analysis (session only)");
  if (enabled.has("add_paper_to_analysis")) mgmtTools.push("add_paper_to_analysis(item_id) — add Zotero item by ID [ID:xxx], auto-builds RAG");
  if (enabled.has("rebuild_paper_rag")) mgmtTools.push("rebuild_paper_rag(paper_index) — force rebuild search index");
  if (enabled.has("add_tag")) mgmtTools.push("add_tag(tag, paper_index? | item_id?) — add a tag to a paper or any item");
  if (enabled.has("remove_tag")) mgmtTools.push("remove_tag(tag, paper_index? | item_id?) — remove a tag from a paper or any item");

  if (analysisTools.length) ctx += "**Paper tools:**\n" + analysisTools.map(t => `- ${t}`).join("\n") + "\n";
  if (libraryTools.length) ctx += "**Library tools:**\n" + libraryTools.map(t => `- ${t}`).join("\n") + "\n";
  if (mgmtTools.length) ctx += "**Management tools:**\n" + mgmtTools.map(t => `- ${t}`).join("\n") + "\n";

  const prefTools = tools.filter(t => t.name.startsWith("pref_"));
  if (prefTools.length > 0) {
    ctx += "\n**User response preferences** — These tools contain the user's preferred answer style for specific types of questions. ";
    ctx += "If you judge that the current conversation involves a topic covered by one of these preferences, call the corresponding tool to load the full style guide, then follow it when composing your answer.\n";
    for (const pt of prefTools) {
      ctx += `- ${pt.name}() — ${pt.description}\n`;
    }
  }

  return ctx;
}

async function getAllCollections(): Promise<any[]> {
  const libraryID = Zotero.Libraries.userLibraryID;
  try {
    const rows: any[] = await Zotero.DB.queryAsync(
      `SELECT collectionID FROM collections WHERE libraryID = ?`, [libraryID],
    );
    return rows.map((r: any) => Zotero.Collections.get(r.collectionID)).filter(Boolean);
  } catch {
    const raw = await Zotero.Collections.getByLibrary(libraryID);
    const topLevel: any[] = raw.map((c: any) => typeof c === "number" ? Zotero.Collections.get(c) : c).filter(Boolean);
    const result: any[] = [];
    function walk(colls: any[]) {
      for (const c of colls) {
        result.push(c);
        try {
          const kids = c.getChildCollections?.(false) || [];
          const kidObjs: any[] = kids.map((k: any) => typeof k === "number" ? Zotero.Collections.get(k) : k).filter(Boolean);
          if (kidObjs.length > 0) walk(kidObjs);
        } catch {}
      }
    }
    walk(topLevel);
    return result;
  }
}

async function resolveCollection(args: Record<string, any>): Promise<any> {
  if (args.collection_id) {
    const c = Zotero.Collections.get(args.collection_id);
    if (c) return c;
  }
  if (args.collection_name) {
    const all = await getAllCollections();
    const target = (args.collection_name as string).toLowerCase();
    return all.find((c: any) => c.name === args.collection_name)
      || all.find((c: any) => (c.name || "").toLowerCase().includes(target))
      || null;
  }
  if (C.standaloneCollectionInfo.id) {
    return Zotero.Collections.get(C.standaloneCollectionInfo.id) || null;
  }
  return null;
}

async function executeTool(name: string, args: Record<string, any>, settings: ReturnType<typeof getFullAnalysisSettings>): Promise<string> {
  const idx = typeof args.paper_index === "number" ? args.paper_index - 1 : -1;

  switch (name) {
    case "load_paper_fulltext": {
      if (idx < 0 || idx >= C.papers.length)
        return `Error: Invalid paper_index ${args.paper_index}. Valid: 1-${C.papers.length}.`;
      const p = C.papers[idx];
      const zItem = Zotero.Items.get(p.id);
      if (!zItem) return `Error: Item not found in Zotero.`;
      const pdf = getBestPdfAttachment(zItem);
      if (!pdf) return `Error: No PDF attachment for "${p.title}".`;
      const text = await getPdfText(pdf);
      if (!text) return `Error: Could not extract text.`;
      if (text.length > FULLTEXT_MAX_CHARS)
        return `[Full text — Paper ${args.paper_index}: ${p.title}] (first ${FULLTEXT_MAX_CHARS} chars of ${text.length})\n\n${text.substring(0, FULLTEXT_MAX_CHARS)}\n\n[...truncated...]`;
      return `[Full text — Paper ${args.paper_index}: ${p.title}]\n\n${text}`;
    }

    case "rag_deep_search": {
      const query = args.query as string;
      if (!query) return `Error: query is required.`;
      let indices: RagIndex[] = [];
      if (idx >= 0) {
        if (idx >= C.papers.length) return `Error: Invalid paper_index.`;
        const ri = C.ragIndices.get(C.papers[idx].id) || await ensureRagForPaper(C.papers[idx].id);
        if (ri) indices.push(ri);
      } else {
        for (const p of C.papers) {
          const ri = C.ragIndices.get(p.id) || await ensureRagForPaper(p.id);
          if (ri) indices.push(ri);
        }
      }
      if (indices.length === 0) return `No RAG indices available.`;
      const sq = await rewriteQueryForSearch(settings, query);
      const results = searchChunksBalanced(sq, indices, 5, 15);
      if (results.length === 0) return `No relevant passages found for: "${query}"`;
      let out = `Found ${results.length} passage(s) for: "${query}"\n\n`;
      for (const r of results) {
        const sec = r.section ? ` | ${r.section}` : "";
        out += `--- [${r.paperTitle}${sec}] (score: ${r.score.toFixed(2)}) ---\n${r.text}\n\n`;
      }
      return out;
    }

    case "get_paper_metadata": {
      if (idx < 0 || idx >= C.papers.length)
        return `Error: Invalid paper_index. Valid: 1-${C.papers.length}.`;
      return getPaperMetadata(C.papers[idx].id) || `No metadata available.`;
    }

    case "get_item_notes": {
      if (idx < 0 || idx >= C.papers.length)
        return `Error: Invalid paper_index. Valid: 1-${C.papers.length}.`;
      try {
        const item = Zotero.Items.get(C.papers[idx].id);
        if (!item) return `Error: Item not found.`;
        const parent = item.isAttachment?.() ? item.parentItem : item;
        const noteIDs: number[] = parent?.getNotes?.() || [];
        if (noteIDs.length === 0) return `No notes attached to Paper ${args.paper_index}: "${C.papers[idx].title}".`;
        let out = `Notes for Paper ${args.paper_index} ("${C.papers[idx].title}"): ${noteIDs.length} note(s)\n\n`;
        for (let i = 0; i < noteIDs.length; i++) {
          const noteItem = Zotero.Items.get(noteIDs[i]);
          if (!noteItem) continue;
          const html = noteItem.getNote?.() || "";
          const text = html.replace(/<[^>]+>/g, "").trim();
          out += `--- Note ${i + 1} ---\n${text || "(empty)"}\n\n`;
        }
        return out;
      } catch (e: any) {
        return `Error reading notes: ${e?.message || e}`;
      }
    }

    case "get_item_annotations": {
      if (idx < 0 || idx >= C.papers.length)
        return `Error: Invalid paper_index. Valid: 1-${C.papers.length}.`;
      try {
        const item = Zotero.Items.get(C.papers[idx].id);
        if (!item) return `Error: Item not found.`;
        const pdf = getBestPdfAttachment(item);
        if (!pdf) return `Error: No PDF attachment for "${C.papers[idx].title}".`;
        const annIDs: number[] = pdf.getAnnotations?.() || [];
        if (annIDs.length === 0) return `No annotations for Paper ${args.paper_index}: "${C.papers[idx].title}".`;
        let out = `Annotations for Paper ${args.paper_index} ("${C.papers[idx].title}"): ${annIDs.length} annotation(s)\n\n`;
        for (const annID of annIDs) {
          const ann = Zotero.Items.get(annID);
          if (!ann) continue;
          const type = ann.annotationType || "unknown";
          const text = ann.annotationText || "";
          const comment = ann.annotationComment || "";
          const page = ann.annotationPageLabel || "?";
          out += `[${type}] p.${page}`;
          if (text) out += `\n  Highlight: "${text}"`;
          if (comment) out += `\n  Comment: ${comment}`;
          out += "\n\n";
        }
        return out;
      } catch (e: any) {
        return `Error reading annotations: ${e?.message || e}`;
      }
    }

    case "list_collections": {
      try {
        const colls = await getAllCollections();
        if (colls.length === 0) return "No collections found in library.";
        const idSet = new Set(colls.map((c: any) => c.id));
        const roots = colls.filter((c: any) => !c.parentID || !idSet.has(c.parentID));
        function tree(node: any, depth: number): string {
          const indent = "  ".repeat(depth);
          let childItemCount = 0;
          try { childItemCount = (node.getChildItems?.(true, false) || []).length; } catch {}
          let s = `${indent}- [ID:${node.id}] ${node.name} (${childItemCount} items)\n`;
          const kids = colls.filter((c: any) => c.parentID === node.id);
          kids.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));
          for (const k of kids) s += tree(k, depth + 1);
          return s;
        }
        roots.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));
        let out = `Found ${colls.length} collection(s):\n\n`;
        for (const r of roots) out += tree(r, 0);
        return out;
      } catch (e: any) {
        return `Error listing collections: ${e?.message || e}`;
      }
    }

    case "list_collection_items": {
      try {
        const coll = await resolveCollection(args);
        if (!coll) return `Collection not found. Use list_collections to see available collections.`;
        const items: any[] = coll.getChildItems?.(false, false) || [];
        const regular = items.filter((it: any) => it.isRegularItem?.());
        if (regular.length === 0) return `Collection "${coll.name}" has no regular items.`;
        const cap = 50;
        let out = `Collection "${coll.name}" — ${regular.length} item(s):\n\n`;
        for (let i = 0; i < Math.min(regular.length, cap); i++)
          out += formatZoteroItemSummary(regular[i]) + "\n";
        if (regular.length > cap) out += `\n...and ${regular.length - cap} more items.`;
        return out;
      } catch (e: any) {
        return `Error: ${e?.message || e}`;
      }
    }

    case "search_library": {
      try {
        const query = args.query as string;
        if (!query) return `Error: query is required.`;
        const limit = Math.min(Math.max((args.limit as number) || 20, 1), 50);
        const s = new Zotero.Search();
        s.libraryID = Zotero.Libraries.userLibraryID;
        s.addCondition("quicksearch-titleCreatorYear", "contains", query);
        const ids: number[] = await s.search();
        if (!ids || ids.length === 0) return `No items found for: "${query}"`;
        const items: any[] = ids.map((id: number) => Zotero.Items.get(id)).filter(Boolean);
        const regular = items.filter((it: any) => it.isRegularItem?.());
        let out = `Search "${query}": ${regular.length} result(s)\n\n`;
        for (let i = 0; i < Math.min(regular.length, limit); i++)
          out += formatZoteroItemSummary(regular[i]) + "\n";
        if (regular.length > limit) out += `\n...and ${regular.length - limit} more results.`;
        return out;
      } catch (e: any) {
        return `Error searching: ${e?.message || e}`;
      }
    }

    case "get_items_by_tag": {
      try {
        const tag = args.tag as string;
        if (!tag) return `Error: tag is required.`;
        const s = new Zotero.Search();
        s.libraryID = Zotero.Libraries.userLibraryID;
        s.addCondition("tag", "is", tag);
        const ids: number[] = await s.search();
        if (!ids || ids.length === 0) return `No items found with tag: "${tag}"`;
        const items: any[] = ids.map((id: number) => Zotero.Items.get(id)).filter(Boolean);
        const regular = items.filter((it: any) => it.isRegularItem?.());
        const cap = 50;
        let out = `Items with tag "${tag}": ${regular.length} result(s)\n\n`;
        for (let i = 0; i < Math.min(regular.length, cap); i++)
          out += formatZoteroItemSummary(regular[i]) + "\n";
        if (regular.length > cap) out += `\n...and ${regular.length - cap} more.`;
        return out;
      } catch (e: any) {
        return `Error: ${e?.message || e}`;
      }
    }

    case "list_tags": {
      try {
        const filter = (args.filter as string) || "";
        let sql = `SELECT t.name AS tag, COUNT(DISTINCT it.itemID) AS cnt
          FROM tags t JOIN itemTags it ON t.tagID = it.tagID
          JOIN items i ON it.itemID = i.itemID
          WHERE i.itemTypeID NOT IN (SELECT itemTypeID FROM itemTypes WHERE typeName IN ('attachment','note','annotation'))`;
        const params: any[] = [];
        if (filter) { sql += ` AND t.name LIKE ?`; params.push(`%${filter}%`); }
        sql += ` GROUP BY t.tagID ORDER BY cnt DESC, t.name ASC LIMIT 200`;
        const rows: any[] = await Zotero.DB.queryAsync(sql, params);
        if (!rows || rows.length === 0) return filter ? `No tags matching "${filter}".` : "No tags found.";
        let out = filter ? `Tags matching "${filter}": ${rows.length}\n\n` : `All tags (${rows.length}, top 200 by count):\n\n`;
        for (const r of rows) out += `  ${r.tag} (${r.cnt})\n`;
        return out;
      } catch (e: any) {
        return `Error listing tags: ${e?.message || e}`;
      }
    }

    case "get_item_collections": {
      if (idx < 0 || idx >= C.papers.length)
        return `Error: Invalid paper_index. Valid: 1-${C.papers.length}.`;
      try {
        const item = Zotero.Items.get(C.papers[idx].id);
        if (!item) return `Error: Item not found.`;
        const parent = item.isAttachment?.() ? item.parentItem : item;
        const collIDs: number[] = parent?.getCollections?.() || [];
        if (collIDs.length === 0) return `Paper ${args.paper_index} ("${C.papers[idx].title}") does not belong to any collection (it may be in "Unfiled Items").`;
        let out = `Paper ${args.paper_index} ("${C.papers[idx].title}") belongs to ${collIDs.length} collection(s):\n\n`;
        for (const cid of collIDs) {
          const coll = Zotero.Collections.get(cid);
          if (!coll) continue;
          const path: string[] = [];
          let cur = coll;
          while (cur) {
            path.unshift(cur.name || `[ID:${cur.id}]`);
            cur = cur.parentID ? Zotero.Collections.get(cur.parentID) : null;
          }
          let childCount = 0;
          try { childCount = (coll.getChildItems?.(true, false) || []).length; } catch {}
          out += `- [ID:${cid}] ${path.join(" / ")} (${childCount} items)\n`;
        }
        return out;
      } catch (e: any) {
        return `Error: ${e?.message || e}`;
      }
    }

    case "get_related_items": {
      if (idx < 0 || idx >= C.papers.length)
        return `Error: Invalid paper_index. Valid: 1-${C.papers.length}.`;
      try {
        const item = Zotero.Items.get(C.papers[idx].id);
        if (!item) return `Error: Item not found.`;
        const parent = item.isAttachment?.() ? item.parentItem : item;
        const relKeys: string[] = parent?.relatedItems || [];
        if (relKeys.length === 0) return `Paper ${args.paper_index} ("${C.papers[idx].title}") has no related items in Zotero.`;
        let out = `Related items for Paper ${args.paper_index} ("${C.papers[idx].title}"): ${relKeys.length}\n\n`;
        for (const key of relKeys) {
          try {
            const rel = Zotero.Items.getByLibraryAndKey(parent.libraryID, key);
            if (rel) out += formatZoteroItemSummary(rel) + "\n";
            else out += `- (key: ${key}) — item not found\n`;
          } catch {
            out += `- (key: ${key}) — could not load\n`;
          }
        }
        return out;
      } catch (e: any) {
        return `Error: ${e?.message || e}`;
      }
    }

    case "get_item_details": {
      try {
        const itemId = args.item_id as number;
        if (!itemId) return `Error: item_id is required.`;
        const item = Zotero.Items.get(itemId);
        if (!item) return `Error: Item ID ${itemId} not found.`;
        const parent = item.isAttachment?.() ? item.parentItem : item;
        if (!parent) return `Error: Cannot resolve parent item.`;
        const fields: string[] = [];
        fields.push(`ID: ${parent.id}`);
        fields.push(`Title: ${parent.getField?.("title") || "(untitled)"}`);
        const creators = parent.getCreators?.() || [];
        if (creators.length > 0) fields.push(`Authors: ${creators.map((c: any) => `${c.firstName || ""} ${c.lastName || ""}`.trim()).join("; ")}`);
        for (const f of ["year", "date", "publicationTitle", "journalAbbreviation", "volume", "issue", "pages", "DOI", "ISBN", "ISSN", "url", "abstractNote", "language", "itemType"]) {
          try {
            const v = parent.getField?.(f);
            if (v) fields.push(`${f}: ${v}`);
          } catch {}
        }
        const tags = parent.getTags?.() || [];
        if (tags.length > 0) fields.push(`Tags: ${tags.map((t: any) => t.tag || t).join(", ")}`);
        const collIDs: number[] = parent.getCollections?.() || [];
        if (collIDs.length > 0) {
          const collNames = collIDs.map((cid: number) => {
            const c = Zotero.Collections.get(cid);
            return c ? c.name : `[ID:${cid}]`;
          });
          fields.push(`Collections: ${collNames.join("; ")}`);
        }
        return fields.join("\n");
      } catch (e: any) {
        return `Error: ${e?.message || e}`;
      }
    }

    case "get_collection_tag_stats": {
      try {
        const coll = await resolveCollection(args);
        if (!coll) return `Collection not found. Provide collection_id or collection_name, or use list_collections to browse.`;
        const limit = Math.min(Math.max((args.limit as number) || 50, 1), 200);
        const rows: any[] = await Zotero.DB.queryAsync(
          `SELECT t.name AS tag, COUNT(DISTINCT ci.itemID) AS cnt
           FROM collectionItems ci
           JOIN itemTags it ON ci.itemID = it.itemID
           JOIN tags t ON it.tagID = t.tagID
           WHERE ci.collectionID = ?
           GROUP BY t.tagID
           ORDER BY cnt DESC, t.name ASC
           LIMIT ?`,
          [coll.id, limit],
        );
        if (!rows || rows.length === 0) return `No tags found in collection "${coll.name}".`;
        let out = `Tag stats for "${coll.name}" (top ${Math.min(rows.length, limit)}):\n\n`;
        for (const r of rows) out += `  ${r.tag} (${r.cnt})\n`;
        return out;
      } catch (e: any) {
        return `Error: ${e?.message || e}`;
      }
    }

    case "get_collection_stats": {
      try {
        const coll = await resolveCollection(args);
        if (!coll) return `Collection not found. Provide collection_id or collection_name.`;
        const items: any[] = (coll.getChildItems?.(false, false) || []).filter((it: any) => it.isRegularItem?.());
        if (items.length === 0) return `Collection "${coll.name}" has no regular items.`;

        const yearCounts: Record<string, number> = {};
        const authorCounts: Record<string, number> = {};
        const typeCounts: Record<string, number> = {};
        for (const it of items) {
          try {
            const year = String(it.getField?.("year") || it.getField?.("date") || "").slice(0, 4) || "Unknown";
            yearCounts[year] = (yearCounts[year] || 0) + 1;
          } catch { yearCounts["Unknown"] = (yearCounts["Unknown"] || 0) + 1; }
          try {
            const creators = it.getCreators?.() || [];
            for (const c of creators) {
              const name = `${c.lastName || ""}${c.firstName ? ", " + c.firstName : ""}`.trim();
              if (name) authorCounts[name] = (authorCounts[name] || 0) + 1;
            }
          } catch {}
          try {
            const type = Zotero.ItemTypes.getName(it.itemTypeID) || "unknown";
            typeCounts[type] = (typeCounts[type] || 0) + 1;
          } catch {}
        }

        let out = `Collection "${coll.name}" — ${items.length} item(s)\n\n`;
        out += "**Item types:**\n";
        for (const [t, c] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) out += `  ${t}: ${c}\n`;
        out += "\n**Year distribution:**\n";
        for (const [y, c] of Object.entries(yearCounts).sort((a, b) => a[0].localeCompare(b[0]))) out += `  ${y}: ${c}\n`;
        const topAuthors = Object.entries(authorCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
        out += `\n**Top authors (top ${topAuthors.length}):**\n`;
        for (const [a, c] of topAuthors) out += `  ${a}: ${c} paper(s)\n`;

        const tagRows: any[] = await Zotero.DB.queryAsync(
          `SELECT t.name AS tag, COUNT(DISTINCT ci.itemID) AS cnt
           FROM collectionItems ci
           JOIN itemTags it ON ci.itemID = it.itemID
           JOIN tags t ON it.tagID = t.tagID
           WHERE ci.collectionID = ?
           GROUP BY t.tagID ORDER BY cnt DESC LIMIT 15`,
          [coll.id],
        );
        if (tagRows.length > 0) {
          out += `\n**Top tags:**\n`;
          for (const r of tagRows) out += `  ${r.tag} (${r.cnt})\n`;
        }
        return out;
      } catch (e: any) {
        return `Error: ${e?.message || e}`;
      }
    }

    case "get_recent_items": {
      try {
        const days = Math.max(1, Math.min((args.days as number) || 7, 365));
        const limit = Math.min(Math.max((args.limit as number) || 20, 1), 100);
        const since = new Date();
        since.setDate(since.getDate() - days);
        const sinceStr = since.toISOString().slice(0, 10) + " 00:00:00";
        const rows: any[] = await Zotero.DB.queryAsync(
          `SELECT itemID FROM items
           WHERE itemTypeID NOT IN (SELECT itemTypeID FROM itemTypes WHERE typeName IN ('attachment', 'note', 'annotation'))
           AND dateAdded >= ?
           ORDER BY dateAdded DESC
           LIMIT ?`,
          [sinceStr, limit],
        );
        if (!rows || rows.length === 0) return `No items added in the last ${days} day(s).`;
        const items = rows.map((r: any) => Zotero.Items.get(r.itemID)).filter(Boolean);
        let out = `Items added in the last ${days} day(s): ${items.length} result(s)\n\n`;
        for (const it of items) {
          try {
            const dateAdded = it.dateAdded ? new Date(it.dateAdded).toLocaleDateString() : "?";
            out += `${formatZoteroItemSummary(it)}  [added: ${dateAdded}]\n`;
          } catch {
            out += formatZoteroItemSummary(it) + "\n";
          }
        }
        return out;
      } catch (e: any) {
        return `Error: ${e?.message || e}`;
      }
    }

    case "remove_paper": {
      if (idx < 0 || idx >= C.papers.length)
        return `Error: Invalid paper_index. Valid: 1-${C.papers.length}.`;
      if (C.papers.length <= 1 && !C.standaloneMode)
        return `Error: Cannot remove the last paper. At least one paper must remain in the analysis set.`;
      const removed = C.papers[idx];
      C.papers.splice(idx, 1);
      C.ragIndices.delete(removed.id);
      renderPaperList();
      return `Removed Paper ${args.paper_index} ("${removed.title}") from the analysis set. ${C.papers.length} paper(s) remaining.`;
    }

    case "add_paper_to_analysis": {
      try {
        const itemId = args.item_id as number;
        if (!itemId) return `Error: item_id is required.`;
        if (C.papers.some(p => p.id === itemId))
          return `Paper with ID ${itemId} is already in the analysis set.`;
        const zItem = Zotero.Items.get(itemId);
        if (!zItem) return `Error: Zotero item ${itemId} not found.`;
        const parent = zItem.isAttachment?.() ? zItem.parentItem : zItem;
        if (!parent) return `Error: Could not resolve item.`;
        if (!parent.isRegularItem?.()) return `Error: Item ${itemId} is not a regular item (may be a note or attachment).`;
        const title = parent.getField?.("title") || "Untitled";
        const paperId = parent.id;
        if (C.papers.some(p => p.id === paperId))
          return `Paper "${title}" (ID:${paperId}) is already in the analysis set.`;
        C.papers.push({ id: paperId, title });
        renderPaperList();
        let ragStatus = "";
        try {
          const ri = await ensureRagForPaper(paperId);
          if (ri) {
            ragStatus = ` RAG index built (${ri.chunks.length} chunks).`;
            await updateRagStatusIndicators();
          } else {
            ragStatus = ` Warning: Could not build RAG index (no PDF text available).`;
          }
        } catch (e: any) {
          ragStatus = ` Warning: RAG index build failed: ${e?.message || e}`;
        }
        return `Added "${title}" (ID:${paperId}) as Paper ${C.papers.length} to the analysis set.${ragStatus}`;
      } catch (e: any) {
        return `Error adding paper: ${e?.message || e}`;
      }
    }

    case "rebuild_paper_rag": {
      if (idx < 0 || idx >= C.papers.length)
        return `Error: Invalid paper_index. Valid: 1-${C.papers.length}.`;
      try {
        const p = C.papers[idx];
        C.ragIndices.delete(p.id);
        const zItem = Zotero.Items.get(p.id);
        if (!zItem) return `Error: Item not found in Zotero.`;
        const pdf = getBestPdfAttachment(zItem);
        if (!pdf) return `Error: No PDF attachment for "${p.title}".`;
        const text = await getPdfText(pdf);
        if (!text) return `Error: Could not extract text from PDF.`;
        const parent = pdf.parentItem || pdf;
        const title = String(parent.getField?.("title") || p.title);
        const newIdx = await buildRagIndexFromText(p.id, title, text);
        await saveRagIndex(newIdx);
        C.ragIndices.set(p.id, newIdx);
        await updateRagStatusIndicators();
        return `RAG index rebuilt for Paper ${args.paper_index} ("${p.title}"): ${newIdx.chunks.length} chunks indexed.`;
      } catch (e: any) {
        return `Error rebuilding RAG: ${e?.message || e}`;
      }
    }

    case "add_tag": {
      const tag = args.tag as string;
      if (!tag) return `Error: tag is required.`;
      try {
        let item: any = null;
        let label = "";
        if (idx >= 0 && idx < C.papers.length) {
          item = Zotero.Items.get(C.papers[idx].id);
          label = `Paper ${args.paper_index} ("${C.papers[idx].title}")`;
        } else if (args.item_id) {
          item = Zotero.Items.get(args.item_id);
          label = `Item ID:${args.item_id}`;
        } else {
          return `Error: Provide paper_index or item_id.`;
        }
        if (!item) return `Error: Item not found.`;
        const parent = item.isAttachment?.() ? item.parentItem : item;
        if (!parent) return `Error: Cannot resolve parent item.`;
        const existingTags = (parent.getTags?.() || []).map((t: any) => t.tag || t);
        if (existingTags.includes(tag)) return `Tag "${tag}" already exists on ${label}.`;
        parent.addTag(tag);
        await parent.saveTx();
        return `Added tag "${tag}" to ${label}. Total tags: ${(parent.getTags?.() || []).length}.`;
      } catch (e: any) {
        return `Error adding tag: ${e?.message || e}`;
      }
    }

    case "remove_tag": {
      const tag = args.tag as string;
      if (!tag) return `Error: tag is required.`;
      try {
        let item: any = null;
        let label = "";
        if (idx >= 0 && idx < C.papers.length) {
          item = Zotero.Items.get(C.papers[idx].id);
          label = `Paper ${args.paper_index} ("${C.papers[idx].title}")`;
        } else if (args.item_id) {
          item = Zotero.Items.get(args.item_id);
          label = `Item ID:${args.item_id}`;
        } else {
          return `Error: Provide paper_index or item_id.`;
        }
        if (!item) return `Error: Item not found.`;
        const parent = item.isAttachment?.() ? item.parentItem : item;
        if (!parent) return `Error: Cannot resolve parent item.`;
        const existingTags = (parent.getTags?.() || []).map((t: any) => t.tag || t);
        if (!existingTags.includes(tag)) return `Tag "${tag}" not found on ${label}. Current tags: ${existingTags.join(", ") || "(none)"}.`;
        parent.removeTag(tag);
        await parent.saveTx();
        return `Removed tag "${tag}" from ${label}. Remaining tags: ${(parent.getTags?.() || []).length}.`;
      } catch (e: any) {
        return `Error removing tag: ${e?.message || e}`;
      }
    }

    default: {
      if (name.startsWith("pref_")) {
        const prefId = name.slice(5);
        const pref = settings.userPreferences.find(p => p.id === prefId);
        if (pref) return `# User Response Preference: ${pref.name}\n\n${pref.prompt}`;
        return `Error: Preference "${prefId}" not found.`;
      }
      return `Unknown tool: ${name}`;
    }
  }
}

function buildPayloadWithTools(
  s: ReturnType<typeof getFullAnalysisSettings>,
  chatMsgs: { role: string; text: string }[],
  userParts: any[],
  toolRounds: { calls: ToolCall[]; results: string[] }[],
  tools: ToolDef[] | null,
): any {
  if (s.provider === "gemini") {
    const contents: any[] = [];
    for (const m of chatMsgs)
      contents.push({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text }] });
    contents.push({ role: "user", parts: userParts });
    for (const r of toolRounds) {
      contents.push({ role: "model", parts: r.calls.map(c => ({ functionCall: { name: c.name, args: c.args } })) });
      contents.push({ role: "user", parts: r.calls.map((c, i) => ({ functionResponse: { name: c.name, response: { result: r.results[i] } } })) });
    }
    const payload: any = { contents };
    if (tools) payload.tools = [{ functionDeclarations: tools }];
    return payload;
  }

  const messages: any[] = [];
  for (const m of chatMsgs)
    messages.push({ role: m.role === "model" ? "assistant" : m.role, content: m.text });
  messages.push({ role: "user", content: userParts.filter((p: any) => p.text).map((p: any) => p.text).join("\n") });
  for (const r of toolRounds) {
    messages.push({
      role: "assistant", content: null,
      tool_calls: r.calls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })),
    });
    for (let i = 0; i < r.calls.length; i++)
      messages.push({ role: "tool", tool_call_id: r.calls[i].id, content: r.results[i] });
  }
  const payload: any = { model: s.model, messages };
  if (tools) payload.tools = tools.map(t => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
  return payload;
}

function parseToolResponse(s: ReturnType<typeof getFullAnalysisSettings>, json: any): { type: "text"; text: string } | { type: "tool_calls"; toolCalls: ToolCall[] } {
  if (s.provider === "gemini") {
    const candidates = json?.candidates || json?.[0]?.candidates;
    const parts = candidates?.[0]?.content?.parts || [];
    const fCalls = parts.filter((p: any) => p.functionCall);
    if (fCalls.length > 0) {
      return {
        type: "tool_calls",
        toolCalls: fCalls.map((p: any, i: number) => ({
          name: p.functionCall.name,
          args: p.functionCall.args || {},
          id: `gc_${Date.now()}_${i}`,
        })),
      };
    }
    let text = "";
    if (Array.isArray(json)) {
      for (const x of json) { const t = x?.candidates?.[0]?.content?.parts?.[0]?.text; if (t) text += t; }
    } else {
      text = parts.filter((p: any) => p.text).map((p: any) => p.text).join("");
    }
    return { type: "text", text };
  }

  const msg = json?.choices?.[0]?.message;
  if (msg?.tool_calls?.length > 0) {
    return {
      type: "tool_calls",
      toolCalls: msg.tool_calls.map((tc: any) => ({
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments || "{}"),
        id: tc.id || `oc_${Date.now()}`,
      })),
    };
  }
  return { type: "text", text: msg?.content || "" };
}

async function runToolCallLoop(
  settings: ReturnType<typeof getFullAnalysisSettings>,
  chatMsgs: { role: string; text: string }[],
  userParts: any[],
  tools: ToolDef[],
  onToolCall?: (tc: ToolCall) => void,
  onToolResult?: (tc: ToolCall, result: string) => void,
): Promise<{ text: string; hitLimit: boolean }> {
  const rounds: { calls: ToolCall[]; results: string[] }[] = [];
  const maxRounds = settings.maxToolRounds;

  for (let r = 0; r < maxRounds; r++) {
    const payload = buildPayloadWithTools(settings, chatMsgs, userParts, rounds, tools);
    const res = await fetchWithRetry(
      buildEndpoint(settings, false),
      { method: "POST", headers: buildHeaders(settings), body: JSON.stringify(payload) },
    );
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const parsed = parseToolResponse(settings, await res.json());

    if (parsed.type === "text") return { text: cleanToolLeakage(parsed.text), hitLimit: false };

    const results: string[] = [];
    for (const tc of parsed.toolCalls) {
      if (onToolCall) onToolCall(tc);
      const result = await executeTool(tc.name, tc.args, settings);
      results.push(result);
      if (onToolResult) onToolResult(tc, result);
    }
    rounds.push({ calls: parsed.toolCalls, results });
  }

  const payload = buildPayloadWithTools(settings, chatMsgs, userParts, rounds, tools);
  const res = await fetchWithRetry(
    buildEndpoint(settings, false),
    { method: "POST", headers: buildHeaders(settings), body: JSON.stringify(payload) },
  );
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  const parsed = parseToolResponse(settings, json);
  const raw = parsed.type === "text" ? parsed.text : "";
  return { text: cleanToolLeakage(raw), hitLimit: true };
}

function cleanToolLeakage(text: string): string {
  return text
    .replace(/<\s*\|?\s*(?:DSML|tool_call|function_call)[^>]*>[\s\S]*?<\s*\/\s*\|?\s*(?:DSML|tool_call|function_call)[^>]*>/gi, "")
    .replace(/```(?:xml|json)?\s*<\s*(?:function_call|tool_call|invoke)[\s\S]*?```/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- Follow-up message ----------

export async function handleFollowUp(userPrompt: string, settings: ReturnType<typeof getFullAnalysisSettings>) {
  const { parts: contextParts, ragInfo } = await buildContextParts(settings, userPrompt);

  if (ragInfo) {
    addMessageBubble("system", esc(ragInfo));
    scrollToBottom();
  }

  let promptText: string;
  if (C.standaloneMode && C.chatHistory.length === 0) {
    const collCtx = C.standaloneCollectionInfo.name
      ? `The user is currently viewing the collection "${C.standaloneCollectionInfo.name}" [ID:${C.standaloneCollectionInfo.id}].`
      : "No specific collection is selected.";
    promptText = `# Role: Zotero AI Research Assistant

You are an expert research assistant integrated into the Zotero reference manager. You have full access to the user's Zotero library through a set of tools.

## Current Context
${collCtx}
${C.papers.length > 0 ? `Analysis papers loaded: ${C.papers.length}` : "No papers are loaded yet. You can search the library and add papers as needed."}

## Your Capabilities
- Search and browse the user's Zotero library (by title, author, tag, collection)
- Load and read full paper texts, metadata, notes, and annotations
- Add papers to the current analysis session and build search indices
- Compare and analyze papers in depth
- Answer research questions based on paper contents

## Guidelines
- When the user asks about papers, proactively use tools to gather information before answering.
- Cite specific papers and passages as evidence.
- If the user asks about their library structure, use collection/tag tools to explore.
- When adding papers to analysis, always load their metadata to confirm the right paper.
- Be proactive: if a question would benefit from searching the library, do it.

## User Question

${userPrompt}

${MATH_FORMAT_INSTRUCTION}`;
  } else {
    promptText = (C.standaloneMode ? userPrompt : settings.followUpPrompt.replace(/\{question\}/g, userPrompt)) + "\n\n" + MATH_FORMAT_INSTRUCTION;
  }

  const userParts: any[] = [...contextParts, { text: promptText }];

  const chatMsgs = C.chatHistory
    .filter(m => m.role === "user" || m.role === "model")
    .map(m => ({ role: m.role, text: m.text }));

  const allTools = getToolDefs();
  const prefTools = getPreferenceToolDefs(settings);
  const tools = [
    ...allTools.filter(t => settings.enabledTools.has(t.name)),
    ...prefTools,
  ];

  if (tools.length > 0) {
    userParts.unshift({ text: buildToolContextPrompt(tools, settings) });
  }

  if (tools.length === 0) {
    const contents: any[] = [];
    for (const msg of C.chatHistory) {
      if (msg.role === "user") contents.push({ role: "user", parts: [{ text: msg.text }] });
      else if (msg.role === "model") contents.push({ role: "model", parts: [{ text: msg.text }] });
    }
    contents.push({ role: "user", parts: userParts });
    const modelBubble = addMessageBubble("model", "");
    let accum = "";
    for await (const chunk of callAIStream(settings, contents)) {
      accum += chunk;
      setChatInnerHTML(modelBubble, renderMd(accum));
      scrollToBottom();
    }
    setChatInnerHTML(modelBubble, renderMd(accum));
    C.chatHistory.push({ role: "user", text: userPrompt });
    C.chatHistory.push({ role: "model", text: accum });
    await saveAnalysisNote();
    return;
  }

  const toolBubble = addMessageBubble("system", "");
  let toolCount = 0;
  const toolHistory: string[] = [];
  let currentToolHtml = "";

  function renderToolBubble() {
    let html = "";
    if (toolHistory.length > 0) {
      html += `<details style="margin-bottom:6px;"><summary style="cursor:pointer;font-size:11px;color:#888;user-select:none;">📋 Tool call history (${toolHistory.length} completed)</summary>`;
      html += `<div style="margin-top:4px;padding:4px 0;border-top:1px solid #e0e0e0;font-size:11px;line-height:1.6;">`;
      html += toolHistory.join("");
      html += `</div></details>`;
    }
    html += currentToolHtml;
    setChatInnerHTML(toolBubble, html);
    scrollToBottom();
  }

  let finalText: string;
  let hitLimit = false;
  try {
    const result = await runToolCallLoop(
      settings, chatMsgs, userParts, tools,
      (tc) => {
        toolCount++;
        const pidx = tc.args.paper_index as number | undefined;
        const pTitle = pidx ? C.papers[pidx - 1]?.title || `Paper ${pidx}` : "";
        let desc: string;
        switch (tc.name) {
          case "load_paper_fulltext": desc = `📄 Loading full text: ${pTitle}`; break;
          case "rag_deep_search": desc = `🔍 Searching: "${tc.args.query}"${pidx ? ` in Paper ${pidx}` : ""}`; break;
          case "get_paper_metadata": desc = `📋 Metadata: ${pTitle}`; break;
          case "get_item_notes": desc = `📝 Notes: ${pTitle}`; break;
          case "get_item_annotations": desc = `✏️ Annotations: ${pTitle}`; break;
          case "list_collections": desc = "📁 Listing collections"; break;
          case "list_collection_items": desc = `📁 Listing items in collection ${tc.args.collection_name || `#${tc.args.collection_id}`}`; break;
          case "search_library": desc = `🔎 Searching library: "${tc.args.query}"`; break;
          case "get_items_by_tag": desc = `🏷️ Filtering by tag: "${tc.args.tag}"`; break;
          case "list_tags": desc = `🏷️ Listing tags${tc.args.filter ? ` (filter: "${tc.args.filter}")` : ""}`; break;
          case "remove_paper": desc = `🗑️ Removing Paper ${pidx}${pTitle ? `: ${pTitle}` : ""}`; break;
          case "add_paper_to_analysis": desc = `➕ Adding item ID:${tc.args.item_id} to analysis`; break;
          case "rebuild_paper_rag": desc = `🔄 Rebuilding RAG for Paper ${pidx}${pTitle ? `: ${pTitle}` : ""}`; break;
          case "get_item_collections": desc = `📂 Checking collections for: ${pTitle}`; break;
          case "get_related_items": desc = `🔗 Finding related items for: ${pTitle}`; break;
          case "get_item_details": desc = `📋 Loading details for item ID:${tc.args.item_id}`; break;
          case "get_collection_tag_stats": desc = `🏷️ Tag stats for collection ${tc.args.collection_name || `#${tc.args.collection_id}` || "(current)"}`; break;
          case "get_collection_stats": desc = `📊 Stats for collection ${tc.args.collection_name || `#${tc.args.collection_id}` || "(current)"}`; break;
          case "get_recent_items": desc = `🕐 Recent items (${tc.args.days || 7} days)`; break;
          case "add_tag": desc = `🏷️ Adding tag "${tc.args.tag}"${pidx ? ` to Paper ${pidx}` : tc.args.item_id ? ` to item ID:${tc.args.item_id}` : ""}`; break;
          case "remove_tag": desc = `🏷️ Removing tag "${tc.args.tag}"${pidx ? ` from Paper ${pidx}` : tc.args.item_id ? ` from item ID:${tc.args.item_id}` : ""}`; break;
          default: {
            if (tc.name.startsWith("pref_")) {
              const prefId = tc.name.slice(5);
              const pref = settings.userPreferences.find(p => p.id === prefId);
              desc = `📖 Loading preference: ${pref?.name || prefId}`;
            } else {
              desc = tc.name;
            }
          }
        }
        currentToolHtml = `<strong>🔧 Tool #${toolCount}</strong>: ${esc(desc)}`;
        renderToolBubble();
      },
      (_tc, result) => {
        const len = result.length;
        const size = len > 1024 ? `${(len / 1024).toFixed(1)}KB` : `${len} chars`;
        const completedHtml = currentToolHtml + ` <span style="color:#34a853;">✅ (${size})</span>`;
        toolHistory.push(`<div style="padding:2px 0;">${completedHtml}</div>`);
        currentToolHtml = "";
        renderToolBubble();
      },
    );
    finalText = result.text;
    hitLimit = result.hitLimit;
  } catch (e: any) {
    if (toolCount > 0) {
      currentToolHtml = `<span style="color:#ea4335;">❌ Error: ${esc(e?.message || String(e))}</span>`;
      renderToolBubble();
    } else {
      toolBubble.remove();
    }
    throw e;
  }

  if (toolCount > 0) {
    let summaryText = `🔧 Used ${toolCount} tool call(s) to gather additional context.`;
    if (hitLimit) {
      summaryText += `<br /><span style="color:#f9ab00;">⚠️ Tool call limit reached (${settings.maxToolRounds} rounds). AI may not have finished gathering all information. You can increase the limit in Settings → AI Tools → Max Tool Call Rounds.</span>`;
    }
    currentToolHtml = summaryText;
    renderToolBubble();
  } else {
    toolBubble.remove();
  }

  const modelBubble = addMessageBubble("model", "");
  setChatInnerHTML(modelBubble, renderMd(finalText));
  scrollToBottom();

  C.chatHistory.push({ role: "user", text: userPrompt });
  C.chatHistory.push({ role: "model", text: finalText });

  await saveAnalysisNote();
}

// ---------- Send handler ----------

let busy = false;
let rerunRequested = false;

/** Shared send pipeline (iframe + reader sidebar). */
export async function processAnalysisUserMessage(userText: string): Promise<void> {
  let settings: ReturnType<typeof getFullAnalysisSettings>;
  try {
    ensureGlobals();
    settings = getFullAnalysisSettings();
  } catch (e: any) {
    addMessageBubble("system", `⚠️ ${esc(e?.message || String(e))}`);
    return;
  }
  if (!settings.apiKey) {
    addMessageBubble("system", "⚠️ Missing API key. Configure in Edit → Settings → Research Copilot.");
    return;
  }

  addMessageBubble("user", esc(userText));

  // Check rerun flag (set by toggle in the UI)
  if (rerunRequested) {
    rerunRequested = false;
    // Auto-uncheck the toggle visually
    const rerunToggle = getRootDocument()?.getElementById("rerun-analysis-toggle") as HTMLInputElement | null;
    if (rerunToggle) rerunToggle.checked = false;
    const hint = getRootDocument()?.getElementById("rerun-hint-banner");
    if (hint) hint.classList.remove("visible");

    if (C.papers.length > 0) {
      addMessageBubble("system", "🔄 Re-running full 4-step analysis pipeline with current papers...");
      await runInitialAnalysis(userText, settings, true);
    } else {
      addMessageBubble("system", "⚠️ No papers loaded. Cannot run full analysis pipeline.");
      await handleFollowUp(userText, settings);
    }
  } else if (C.chatHistory.length === 0 && !C.standaloneMode && C.papers.length > 0) {
    await runInitialAnalysis(userText, settings);
  } else {
    await handleFollowUp(userText, settings);
  }
}

async function handleSend() {
  if (busy) return;
  const input = $("chat-input") as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text) return;

  try {
    ensureGlobals();
    getFullAnalysisSettings();
  } catch (e: any) {
    addMessageBubble("system", `⚠️ ${esc(e?.message || String(e))}`);
    return;
  }
  const settings = getFullAnalysisSettings();
  if (!settings.apiKey) {
    addMessageBubble("system", "⚠️ Missing API key. Configure in Edit → Settings → Research Copilot.");
    return;
  }

  input.value = "";
  input.style.height = "auto";

  const btn = $("btn-send") as HTMLButtonElement;
  busy = true;
  btn.disabled = true;
  btn.textContent = "...";
  input.disabled = true;

  try {
    await processAnalysisUserMessage(text);
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
  const doc = getRootDocument();
  if (!doc) return;
  for (const p of C.papers) {
    let dot: HTMLElement | null = null;
    try {
      const idPart = typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(String(p.id))
        : String(p.id).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      dot = doc.querySelector(`[data-rag-id="${idPart}"]`) as HTMLElement | null;
    } catch {
      continue;
    }
    if (!dot) continue;
    let has = C.ragIndices.has(p.id);
    if (!has) {
      try { has = await hasRagIndex(p.id); } catch (_) { has = false; }
    }
    dot.style.background = has ? "#007AFF" : "#d1d5db";
    dot.title = has ? "RAG index ready" : "No RAG index yet";
  }
}

function getPapers(): PaperInfo[] {
  try {
    const params = new URLSearchParams(getLocationSearch());
    const raw = params.get("data");
    if (raw) {
      let decoded = raw;
      try { decoded = decodeURIComponent(raw); } catch (_) { /* already decoded */ }
      let parsed: any;
      try { parsed = JSON.parse(decoded); } catch (_) { parsed = JSON.parse(raw); }
      if (parsed && parsed.mode === "standalone") {
        C.standaloneMode = true;
        C.standaloneCollectionInfo = parsed.collection || {};
        return [];
      }
      // New format: { papers: [...], collection: {...} }
      if (parsed && parsed.papers && Array.isArray(parsed.papers)) {
        if (parsed.collection) {
          C.standaloneCollectionInfo = parsed.collection;
        }
        return parsed.papers;
      }
      // Legacy format: plain array of papers
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_e) { /* ignore */ }
  return [];
}

interface SessionData {
  version: number;
  createdAt: string;
  savedAt: string;
  standaloneMode: boolean;
  standaloneCollectionInfo: { id?: number; name?: string };
  papers: PaperInfo[];
  chatHistory: ChatMsg[];
  questionUnderstandingDoc: string;
  analysisDoc: string;
}

/** Read JSON session from a stored attachment; retry while Zotero file sync may still be downloading. */
async function readSessionDataFromAttachment(attItem: Zotero.Item | any): Promise<SessionData | null> {
  const tryOnce = async (): Promise<SessionData | null> => {
    try {
      const path = await attItem.getFilePathAsync();
      if (path && (await IOUtils.exists(path))) {
        const raw = await IOUtils.readUTF8(path);
        const data = JSON.parse(raw) as SessionData;
        if (data.version && Array.isArray(data.chatHistory)) return data;
      }
    } catch (e) {
      Zotero.debug("[ResearchCopilot] readSessionDataFromAttachment: " + e);
    }
    return null;
  };

  let data = await tryOnce();
  if (data) return data;
  for (let i = 0; i < 30; i++) {
    await new Promise<void>((r) => setTimeout(r, 400));
    data = await tryOnce();
    if (data) return data;
  }
  return null;
}

/** Collect attachment candidates: library+key is stable across sync; local itemID is not. */
function collectSessionAttachmentCandidates(noteHtml: string): Zotero.Item[] {
  const out: Zotero.Item[] = [];
  const seen = new Set<number>();

  const pushItem = (it: unknown) => {
    if (!it || typeof it !== "object") return;
    const item = it as Zotero.Item & { deleted?: boolean; id?: number };
    if (!item.id || item.deleted) return;
    if (seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item as Zotero.Item);
  };

  const lkh = noteHtml.match(/data-analysis-attachment-lkh="(\d+)_([A-Za-z0-9]{8})"/i);
  if (lkh) {
    const libId = parseInt(lkh[1], 10);
    const key = lkh[2].toUpperCase();
    try {
      pushItem(Zotero.Items.getByLibraryAndKey(libId, key));
    } catch { /* ignore */ }
  }

  const linkRe = /zotero:\/\/select\/items\/(\d+)_([A-Za-z0-9]{8})/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(noteHtml)) !== null) {
    const libId = parseInt(lm[1], 10);
    const key = lm[2].toUpperCase();
    try {
      pushItem(Zotero.Items.getByLibraryAndKey(libId, key));
    } catch { /* ignore */ }
  }

  const textMatch = noteHtml.match(/ResearchCopilotSessionID:(\d+)/);
  if (textMatch) pushItem(Zotero.Items.get(parseInt(textMatch[1], 10)));

  const attMatch = noteHtml.match(/data-analysis-attachment-id="(\d+)"/);
  if (attMatch) pushItem(Zotero.Items.get(parseInt(attMatch[1], 10)));

  return out;
}

async function parseSessionFromNote(noteHtml: string): Promise<SessionData | null> {
  const candidates = collectSessionAttachmentCandidates(noteHtml);

  for (const attItem of candidates) {
    if (!attItem.isAttachment()) continue;
    const data = await readSessionDataFromAttachment(attItem);
    if (data) {
      C.savedAttachmentId = attItem.id;
      return data;
    }
  }

  const m = noteHtml.match(/data-analysis-session[^>]*>([\s\S]*?)<\/div>/);
  if (!m) return null;
  try {
    const raw = m[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    const data = JSON.parse(raw) as SessionData;
    if (!data.version || !Array.isArray(data.chatHistory)) return null;
    return data;
  } catch { return null; }
}

async function restoreSession(session: SessionData) {
  C.papers = session.papers || [];
  C.chatHistory = session.chatHistory || [];
  C.questionUnderstandingDoc = session.questionUnderstandingDoc || "";
  C.analysisDoc = session.analysisDoc || "";
  C.standaloneMode = session.standaloneMode || false;
  C.standaloneCollectionInfo = session.standaloneCollectionInfo || {};
  C.sessionCreatedAt = session.createdAt || "";

  renderPaperList();

  const chatEl = $("chat-messages");
  chatEl.innerHTML = "";

  addMessageBubble("system",
    `📂 Restored session from <strong>${esc(session.createdAt)}</strong> · ` +
    `${C.papers.length} paper(s) · ${C.chatHistory.filter(m => m.role === "user").length} question(s)`
  );

  for (const msg of C.chatHistory) {
    if (msg.role === "user") {
      addMessageBubble("user", esc(msg.text));
    } else if (msg.role === "model") {
      addMessageBubble("model", renderMd(msg.text));
    } else {
      addMessageBubble("system", esc(msg.text));
    }
  }

  scrollToBottom(true);

  for (const p of C.papers) {
    try {
      if (await hasRagIndex(p.id)) {
        const idx = await loadRagIndex(p.id);
        if (idx) C.ragIndices.set(p.id, idx);
      }
    } catch {}
  }
  updateRagStatusIndicators();
}

async function showLoadSessionPicker() {
  try {
    ensureGlobals();
  } catch (e: any) {
    addMessageBubble("system", `⚠️ ${esc(e?.message || String(e))}`);
    return;
  }

  const rows: any[] = await Zotero.DB.queryAsync(
    `SELECT itemID FROM itemNotes WHERE note LIKE '%data-analysis-session%' OR note LIKE '%data-analysis-attachment-lkh%' OR note LIKE '%data-analysis-attachment-id%' OR note LIKE '%ResearchCopilotSessionID:%'
     ORDER BY itemID DESC LIMIT 50`
  );
  if (!rows || rows.length === 0) {
    addMessageBubble("system", "No saved analysis sessions found.");
    return;
  }

  const sessions: { noteId: number; title: string; session: SessionData }[] = [];
  for (const r of rows) {
    try {
      const item = Zotero.Items.get(r.itemID);
      if (!item || item.deleted) continue;
      const html = item.getNote?.() || "";
      const s = await parseSessionFromNote(html);
      if (!s) continue;
      const paperCount = s.papers?.length || 0;
      const qCount = s.chatHistory?.filter((m: ChatMsg) => m.role === "user").length || 0;
      const firstQ = s.chatHistory?.find((m: ChatMsg) => m.role === "user")?.text || "";
      const topic = firstQ.length > 40 ? firstQ.slice(0, 40) + "…" : firstQ;
      const title = `[${s.createdAt}] ${paperCount} papers, ${qCount} Q — ${topic || "(no question)"}`;
      sessions.push({ noteId: r.itemID, title, session: s });
    } catch {}
  }

  if (sessions.length === 0) {
    addMessageBubble("system", "No valid analysis sessions found in saved notes.");
    return;
  }

  const dom = getRootDocument();
  if (!dom.body) return;

  const overlay = dom.createElement("div");
  overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;";

  const dialog = dom.createElement("div");
  dialog.style.cssText = "background:white;border-radius:14px;max-width:560px;width:90%;max-height:70vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);";

  const header = dom.createElement("div");
  header.style.cssText = "padding:16px 20px;font-size:15px;font-weight:700;border-bottom:1px solid #e5e5e5;";
  header.textContent = `📂 Load Previous Session (${sessions.length})`;
  dialog.appendChild(header);

  const listWrap = dom.createElement("div");
  listWrap.style.cssText = "flex:1;overflow-y:auto;padding:8px;";

  for (const s of sessions) {
    const row = dom.createElement("div");
    row.style.cssText = "padding:10px 12px;border-radius:8px;cursor:pointer;font-size:13px;line-height:1.5;margin-bottom:4px;border:1px solid #e5e5e5;transition:background 0.15s;";
    row.textContent = s.title;
    row.addEventListener("mouseenter", () => { row.style.background = "#f0f5ff"; });
    row.addEventListener("mouseleave", () => { row.style.background = ""; });
    row.addEventListener("click", async () => {
      overlay.remove();
      C.savedNoteId = s.noteId;
      await restoreSession(s.session);
    });
    listWrap.appendChild(row);
  }
  dialog.appendChild(listWrap);

  const footer = dom.createElement("div");
  footer.style.cssText = "padding:12px 20px;border-top:1px solid #e5e5e5;text-align:right;";
  const cancelBtn = dom.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = "padding:6px 16px;border:1px solid #e5e5e5;border-radius:8px;background:white;cursor:pointer;font-size:13px;";
  cancelBtn.addEventListener("click", () => overlay.remove());
  footer.appendChild(cancelBtn);
  dialog.appendChild(footer);

  overlay.appendChild(dialog);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  dom.body.appendChild(overlay);
}

function renderPaperList() {
  const list = $("paper-check-list");
  const listDoc = list.ownerDocument || getRootDocument();
  if (!listDoc) return;
  if (C.papers.length === 0) {
    setChatInnerHTML(list, `<div style="padding:12px;color:#86868b;font-size:12px;">No papers loaded</div>`);
  } else {
    list.textContent = "";
    C.papers.forEach((p, i) => {
      const item = listDoc.createElement("div");
      item.className = "paper-check-item";
      item.setAttribute("data-paper-id", String(p.id));
      item.title = `${p.title}\n(Double-click to locate in Zotero)`;
      item.style.cursor = "pointer";
      setChatInnerHTML(item, `<span class="paper-check-label">${i + 1}. ${esc(p.title)}</span><span class="rag-status-dot" data-rag-id="${p.id}"></span>`);
      item.addEventListener("dblclick", () => {
        try {
          const win = (getGlobalRoot() as any);
          const mainWin = win?.opener || win;
          const zp = mainWin?.ZoteroPane || mainWin?.Zotero?.getActiveZoteroPane?.();
          if (zp) {
            const zItem = Zotero.Items.get(p.id);
            if (zItem) {
              zp.selectItem(zItem.id);
              mainWin.focus?.();
            }
          }
        } catch (_) { /* ignore */ }
      });
      list.appendChild(item);
    });
  }
  updateRagStatusIndicators();
}

async function init() {
  try { ensureGlobals(); } catch (_e) { /* will fail later with message */ }

  const input = $("chat-input") as HTMLTextAreaElement;
  const btn = $("btn-send") as HTMLButtonElement;
  
  initMathCopyListener($("chat-messages"));

  btn.addEventListener("click", handleSend);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
  });

  const rootDoc = getRootDocument();
  const loadBtn = rootDoc?.getElementById("btn-load-session");
  if (loadBtn) loadBtn.addEventListener("click", () => showLoadSessionPicker());
  const saveBtn = rootDoc?.getElementById("btn-save-session");
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    if (C.chatHistory.length === 0) {
      addMessageBubble("system", "Nothing to save yet — start a conversation first.");
      return;
    }
    await saveAnalysisNote();
    addMessageBubble("system", `💾 Session saved${C.savedNoteId ? ` (Note ID: ${C.savedNoteId})` : ""}.`);
  });

  // Rerun analysis toggle hint
  const rerunToggle = rootDoc?.getElementById("rerun-analysis-toggle") as HTMLInputElement | null;
  const rerunHint = rootDoc?.getElementById("rerun-hint-banner");
  if (rerunToggle && rerunHint) {
    rerunToggle.addEventListener("change", () => {
      rerunRequested = rerunToggle.checked;
      if (rerunToggle.checked) {
        rerunHint.classList.add("visible");
      } else {
        rerunHint.classList.remove("visible");
      }
    });
  }

  let loadedFromNote = false;
  try {
    const params = new URLSearchParams(getLocationSearch());
    const raw = params.get("data");
    if (raw) {
      let decoded = raw;
      try { decoded = decodeURIComponent(raw); } catch (_) {}
      let parsed: any;
      try { parsed = JSON.parse(decoded); } catch (_) { parsed = JSON.parse(raw); }
      if (parsed && parsed.mode === "loadNote" && parsed.noteId) {
        const noteItem = Zotero.Items.get(parsed.noteId) as Zotero.Item | false;
        if (noteItem) {
          const html = noteItem.getNote?.() || "";
          const session = await parseSessionFromNote(html);
          if (session) {
            C.savedNoteId = parsed.noteId;
            await restoreSession(session);
            loadedFromNote = true;
          } else {
            loadedFromNote = true;
            renderPaperList();
            addMessageBubble(
              "system",
              "Could not restore this analysis session. The session JSON is usually stored as a child attachment of <strong>Research Copilot History</strong> — " +
                "wait until Zotero has finished <strong>file sync</strong> for that attachment, then try Resume again. " +
                "If this note was saved on another device, make sure you are on the latest plugin version (it resolves attachments by sync-stable keys, not local item IDs).",
            );
          }
        } else {
          loadedFromNote = true;
          renderPaperList();
          addMessageBubble("system", "Note not found — it may have been removed or is not synced to this library yet.");
        }
      }
    }
  } catch {}

  if (!loadedFromNote) {
    C.papers = getPapers();
    renderPaperList();

    if (C.standaloneMode) {
      const collHint = C.standaloneCollectionInfo.name
        ? `Current collection: <strong>${esc(C.standaloneCollectionInfo.name)}</strong> [ID:${C.standaloneCollectionInfo.id}]`
        : "No collection selected";
      addMessageBubble("system",
        `🤖 <strong>AI Research Assistant</strong><br /><br />` +
        `${collHint}<br /><br />` +
        `I can help you explore and analyze your Zotero library. Try asking me things like:<br />` +
        `• "List the papers in my current collection"<br />` +
        `• "Search for papers about diffusion models"<br />` +
        `• "Find papers tagged with 'reinforcement learning'"<br />` +
        `• "Add paper ID:xxx to analysis and summarize it"<br />` +
        `• "Compare the methods in papers 1 and 2"<br /><br />` +
        `All available tools (search, metadata, full text, annotations, etc.) are enabled. Just start a conversation!`
      );
    } else if (C.papers.length > 0) {
      addMessageBubble("system", `${C.papers.length} paper(s) loaded. Type your research question to start the 4-phase analysis pipeline:\n① RAG Index → ② Question Understanding → ③ Per-paper Extraction → ④ Synthesis.\nFollow-up questions will automatically search all papers via RAG.`);
    }
  }

  input.focus();
}

/** Analysis iframe has #chat-input; main Zotero window loads this module too (reader sidebar) — must not run init there. */
function isAnalysisIframeDocument(): boolean {
  try {
    const doc = (getGlobalRoot() as any).document;
    return doc && typeof doc.getElementById === "function" && !!doc.getElementById("chat-input");
  } catch {
    return false;
  }
}

if (isAnalysisIframeDocument()) {
  const rootDoc = getRootDocument();
  if (rootDoc) {
    if (rootDoc.readyState === "loading") {
      rootDoc.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
}
