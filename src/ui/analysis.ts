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
      md.use(tm, { engine: katex, delimiters: ["dollars", "brackets"], katexOptions: { output: "html", throwOnError: false } });
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
    "remove_paper", "add_paper_to_analysis", "rebuild_paper_rag",
  ];
  let enabledTools: Set<string>;
  try {
    const raw = Z.Prefs.get(`${pfx}.enabledTools`, true) as string;
    enabledTools = raw ? new Set(JSON.parse(raw) as string[]) : new Set(ALL_TOOL_NAMES);
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
    maxToolRounds: Math.max(1, Math.min(100, parseInt((Z.Prefs.get(`${pfx}.maxToolRounds`, true) as string) || "15", 10) || 15)),
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

function normalizeMathDelimiters(src: string): string {
  src = src.replace(/```(?:latex|math|tex)?\s*\n([\s\S]*?)```/g, (_m, p1) => `$$${p1.trim()}$$`);
  src = src.replace(/\\\[([\s\S]*?)\\\]/g, (_m, p1) => `$$${p1}$$`);
  src = src.replace(/\\\((.+?)\\\)/g, (_m, p1) => `$${p1}$`);
  return src;
}

function renderMd(text: string): string {
  try { return getMarkdown().render(normalizeMathDelimiters(text)); } catch (_) { return esc(text); }
}

function esc(t: string) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escAttr(t: string) { return t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

const MATH_FORMAT_INSTRUCTION = "Formatting rule: When writing mathematical formulas, always use $...$ for inline math and $$...$$ (on its own line) for display math. Never wrap formulas in code blocks (backticks). This is critical for correct rendering.";

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

  // === Phase 2: Question Understanding (AI call, with paper metadata) ===
  const quBubble = addMessageBubble("system", `<strong>🧠 Phase 2/4 — Analyzing research question...</strong>`);
  scrollToBottom();

  const paperMetaList = buildPaperInfoSection();
  const quPrompt = settings.questionUnderstandingPrompt
    .replace(/\{question\}/g, userPrompt)
    .replace(/\{paper_list\}/g, paperMetaList)
    .replace(/\{count\}/g, String(allPdfs.length));
  try {
    questionUnderstandingDoc = await callAI(settings, [{ role: "user" as const, parts: [{ text: quPrompt + "\n\n" + MATH_FORMAT_INSTRUCTION }] }]);
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

  analysisDoc = extractions.join("\n\n---\n\n");

  chatHistory.push({ role: "user", text: userPrompt });
  await saveAnalysisNote();

  // === Phase 4: Synthesis (with question understanding context) ===
  progressBubble.innerHTML = `✅ Phase 3/4 — All ${allPdfs.length} papers extracted. Starting synthesis...`;
  scrollToBottom();

  const synthPrompt = settings.synthesisPrompt
    .replace(/\{question\}/g, userPrompt)
    .replace(/\{understanding\}/g, questionUnderstandingDoc || "(Question understanding not available.)")
    .replace(/\{extractions\}/g, analysisDoc || "(No extraction results available.)")
    .replace(/\{count\}/g, String(allPdfs.length));

  const synthContents = [{ role: "user" as const, parts: [{ text: synthPrompt + "\n\n" + MATH_FORMAT_INSTRUCTION }] }];

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
    { name: "remove_paper", description: "Remove paper from analysis", parameters: { type: "object", properties: { paper_index: { type: "number" } }, required: ["paper_index"] } },
    { name: "add_paper_to_analysis", description: "Add item to analysis by ID", parameters: { type: "object", properties: { item_id: { type: "number" } }, required: ["item_id"] } },
    { name: "rebuild_paper_rag", description: "Rebuild RAG index", parameters: { type: "object", properties: { paper_index: { type: "number" } }, required: ["paper_index"] } },
  ];
}

function getPreferenceToolDefs(settings: ReturnType<typeof getSettings>): ToolDef[] {
  return settings.userPreferences.map(pref => ({
    name: `pref_${pref.id}`,
    description: pref.description,
    parameters: { type: "object", properties: {}, required: [] },
  }));
}

function buildToolContextPrompt(tools: ToolDef[], settings: ReturnType<typeof getSettings>): string {
  const paperLines = papers.map((p, i) => `  ${i + 1}. "${p.title}"`).join("\n");
  const enabled = new Set(tools.map(t => t.name));

  let ctx = `## Available Tools\nAnalysis papers (paper_index is 1-based):\n${paperLines}\n\n`;

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
  if (enabled.has("list_tags")) libraryTools.push("list_tags(filter?) — list all tags, optionally filtered");
  if (enabled.has("get_item_details")) libraryTools.push("get_item_details(item_id) — full metadata, tags, collections for any Zotero item by ID");

  if (enabled.has("remove_paper")) mgmtTools.push("remove_paper(paper_index) — remove paper from analysis (session only)");
  if (enabled.has("add_paper_to_analysis")) mgmtTools.push("add_paper_to_analysis(item_id) — add Zotero item by ID [ID:xxx], auto-builds RAG");
  if (enabled.has("rebuild_paper_rag")) mgmtTools.push("rebuild_paper_rag(paper_index) — force rebuild search index");

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

async function executeTool(name: string, args: Record<string, any>, settings: ReturnType<typeof getSettings>): Promise<string> {
  const idx = typeof args.paper_index === "number" ? args.paper_index - 1 : -1;

  switch (name) {
    case "load_paper_fulltext": {
      if (idx < 0 || idx >= papers.length)
        return `Error: Invalid paper_index ${args.paper_index}. Valid: 1-${papers.length}.`;
      const p = papers[idx];
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
        if (idx >= papers.length) return `Error: Invalid paper_index.`;
        const ri = ragIndices.get(papers[idx].id) || await ensureRagForPaper(papers[idx].id);
        if (ri) indices.push(ri);
      } else {
        for (const p of papers) {
          const ri = ragIndices.get(p.id) || await ensureRagForPaper(p.id);
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
      if (idx < 0 || idx >= papers.length)
        return `Error: Invalid paper_index. Valid: 1-${papers.length}.`;
      return getPaperMetadata(papers[idx].id) || `No metadata available.`;
    }

    case "get_item_notes": {
      if (idx < 0 || idx >= papers.length)
        return `Error: Invalid paper_index. Valid: 1-${papers.length}.`;
      try {
        const item = Zotero.Items.get(papers[idx].id);
        if (!item) return `Error: Item not found.`;
        const parent = item.isAttachment?.() ? item.parentItem : item;
        const noteIDs: number[] = parent?.getNotes?.() || [];
        if (noteIDs.length === 0) return `No notes attached to Paper ${args.paper_index}: "${papers[idx].title}".`;
        let out = `Notes for Paper ${args.paper_index} ("${papers[idx].title}"): ${noteIDs.length} note(s)\n\n`;
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
      if (idx < 0 || idx >= papers.length)
        return `Error: Invalid paper_index. Valid: 1-${papers.length}.`;
      try {
        const item = Zotero.Items.get(papers[idx].id);
        if (!item) return `Error: Item not found.`;
        const pdf = getBestPdfAttachment(item);
        if (!pdf) return `Error: No PDF attachment for "${papers[idx].title}".`;
        const annIDs: number[] = pdf.getAnnotations?.() || [];
        if (annIDs.length === 0) return `No annotations for Paper ${args.paper_index}: "${papers[idx].title}".`;
        let out = `Annotations for Paper ${args.paper_index} ("${papers[idx].title}"): ${annIDs.length} annotation(s)\n\n`;
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
        const libraryID = Zotero.Libraries.userLibraryID;
        const raw = await Zotero.Collections.getByLibrary(libraryID);
        if (!raw || raw.length === 0) return "No collections found in library.";
        const colls: any[] = raw.map((c: any) => typeof c === "number" ? Zotero.Collections.get(c) : c).filter(Boolean);
        const roots = colls.filter((c: any) => !c.parentID);
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
        const libraryID = Zotero.Libraries.userLibraryID;
        let coll: any = null;
        if (args.collection_id) {
          coll = Zotero.Collections.get(args.collection_id);
        }
        if (!coll && args.collection_name) {
          const raw = await Zotero.Collections.getByLibrary(libraryID);
          const all: any[] = raw.map((c: any) => typeof c === "number" ? Zotero.Collections.get(c) : c).filter(Boolean);
          const target = (args.collection_name as string).toLowerCase();
          coll = all.find((c: any) => c.name === args.collection_name)
            || all.find((c: any) => (c.name || "").toLowerCase().includes(target));
        }
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
        const libraryID = Zotero.Libraries.userLibraryID;
        const filter = (args.filter as string) || "";
        let tagMap: any;
        try {
          tagMap = await Zotero.Tags.getAll(libraryID);
        } catch {
          const s = new Zotero.Search();
          s.libraryID = libraryID;
          s.addCondition("noChildren", "true");
          const ids: number[] = await s.search();
          const items: any[] = ids.map((id: number) => Zotero.Items.get(id)).filter(Boolean);
          const tagSet = new Set<string>();
          for (const it of items) {
            try { for (const t of (it.getTags?.() || [])) tagSet.add(t.tag || t); } catch {}
          }
          const arr = [...tagSet].sort();
          const filtered = filter ? arr.filter(t => t.toLowerCase().includes(filter.toLowerCase())) : arr;
          if (filtered.length === 0) return filter ? `No tags matching "${filter}".` : "No tags found.";
          return (filter ? `Tags matching "${filter}": ${filtered.length}\n\n` : `All tags (${filtered.length}):\n\n`) + filtered.join(", ");
        }
        let tagNames: string[];
        if (tagMap instanceof Map) {
          tagNames = [...tagMap.values()].map((v: any) => typeof v === "string" ? v : v?.tag || String(v));
        } else if (Array.isArray(tagMap)) {
          tagNames = tagMap.map((t: any) => typeof t === "string" ? t : t?.tag || t?.name || String(t));
        } else if (typeof tagMap === "object") {
          tagNames = Object.values(tagMap).map((v: any) => typeof v === "string" ? v : v?.tag || String(v));
        } else {
          return `Unexpected tag data format.`;
        }
        tagNames.sort();
        const filtered = filter ? tagNames.filter(t => t.toLowerCase().includes(filter.toLowerCase())) : tagNames;
        if (filtered.length === 0) return filter ? `No tags matching "${filter}".` : "No tags found.";
        let out = filter ? `Tags matching "${filter}": ${filtered.length}\n\n` : `All tags (${filtered.length}):\n\n`;
        out += filtered.join(", ");
        return out;
      } catch (e: any) {
        return `Error listing tags: ${e?.message || e}`;
      }
    }

    case "get_item_collections": {
      if (idx < 0 || idx >= papers.length)
        return `Error: Invalid paper_index. Valid: 1-${papers.length}.`;
      try {
        const item = Zotero.Items.get(papers[idx].id);
        if (!item) return `Error: Item not found.`;
        const parent = item.isAttachment?.() ? item.parentItem : item;
        const collIDs: number[] = parent?.getCollections?.() || [];
        if (collIDs.length === 0) return `Paper ${args.paper_index} ("${papers[idx].title}") does not belong to any collection (it may be in "Unfiled Items").`;
        let out = `Paper ${args.paper_index} ("${papers[idx].title}") belongs to ${collIDs.length} collection(s):\n\n`;
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
      if (idx < 0 || idx >= papers.length)
        return `Error: Invalid paper_index. Valid: 1-${papers.length}.`;
      try {
        const item = Zotero.Items.get(papers[idx].id);
        if (!item) return `Error: Item not found.`;
        const parent = item.isAttachment?.() ? item.parentItem : item;
        const relKeys: string[] = parent?.relatedItems || [];
        if (relKeys.length === 0) return `Paper ${args.paper_index} ("${papers[idx].title}") has no related items in Zotero.`;
        let out = `Related items for Paper ${args.paper_index} ("${papers[idx].title}"): ${relKeys.length}\n\n`;
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

    case "remove_paper": {
      if (idx < 0 || idx >= papers.length)
        return `Error: Invalid paper_index. Valid: 1-${papers.length}.`;
      if (papers.length <= 1)
        return `Error: Cannot remove the last paper. At least one paper must remain in the analysis set.`;
      const removed = papers[idx];
      papers.splice(idx, 1);
      ragIndices.delete(removed.id);
      renderPaperList();
      return `Removed Paper ${args.paper_index} ("${removed.title}") from the analysis set. ${papers.length} paper(s) remaining.`;
    }

    case "add_paper_to_analysis": {
      try {
        const itemId = args.item_id as number;
        if (!itemId) return `Error: item_id is required.`;
        if (papers.some(p => p.id === itemId))
          return `Paper with ID ${itemId} is already in the analysis set.`;
        const zItem = Zotero.Items.get(itemId);
        if (!zItem) return `Error: Zotero item ${itemId} not found.`;
        const parent = zItem.isAttachment?.() ? zItem.parentItem : zItem;
        if (!parent) return `Error: Could not resolve item.`;
        if (!parent.isRegularItem?.()) return `Error: Item ${itemId} is not a regular item (may be a note or attachment).`;
        const title = parent.getField?.("title") || "Untitled";
        const paperId = parent.id;
        if (papers.some(p => p.id === paperId))
          return `Paper "${title}" (ID:${paperId}) is already in the analysis set.`;
        papers.push({ id: paperId, title });
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
        return `Added "${title}" (ID:${paperId}) as Paper ${papers.length} to the analysis set.${ragStatus}`;
      } catch (e: any) {
        return `Error adding paper: ${e?.message || e}`;
      }
    }

    case "rebuild_paper_rag": {
      if (idx < 0 || idx >= papers.length)
        return `Error: Invalid paper_index. Valid: 1-${papers.length}.`;
      try {
        const p = papers[idx];
        ragIndices.delete(p.id);
        const zItem = Zotero.Items.get(p.id);
        if (!zItem) return `Error: Item not found in Zotero.`;
        const pdf = getBestPdfAttachment(zItem);
        if (!pdf) return `Error: No PDF attachment for "${p.title}".`;
        const text = await getPdfText(pdf);
        if (!text) return `Error: Could not extract text from PDF.`;
        const parent = pdf.parentItem || pdf;
        const title = String(parent.getField?.("title") || p.title);
        const newIdx = buildRagIndexFromText(p.id, title, text);
        await saveRagIndex(newIdx);
        ragIndices.set(p.id, newIdx);
        await updateRagStatusIndicators();
        return `RAG index rebuilt for Paper ${args.paper_index} ("${p.title}"): ${newIdx.chunks.length} chunks indexed.`;
      } catch (e: any) {
        return `Error rebuilding RAG: ${e?.message || e}`;
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
  s: ReturnType<typeof getSettings>,
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

function parseToolResponse(s: ReturnType<typeof getSettings>, json: any): { type: "text"; text: string } | { type: "tool_calls"; toolCalls: ToolCall[] } {
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
  settings: ReturnType<typeof getSettings>,
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

async function handleFollowUp(userPrompt: string, settings: ReturnType<typeof getSettings>) {
  const { parts: contextParts, ragInfo } = await buildContextParts(settings, userPrompt);

  if (ragInfo) {
    addMessageBubble("system", esc(ragInfo));
    scrollToBottom();
  }

  const wrappedPrompt = settings.followUpPrompt.replace(/\{question\}/g, userPrompt);
  const userParts: any[] = [...contextParts, { text: wrappedPrompt + "\n\n" + MATH_FORMAT_INSTRUCTION }];

  const chatMsgs = chatHistory
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
    for (const msg of chatHistory) {
      if (msg.role === "user") contents.push({ role: "user", parts: [{ text: msg.text }] });
      else if (msg.role === "model") contents.push({ role: "model", parts: [{ text: msg.text }] });
    }
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
    return;
  }

  const toolBubble = addMessageBubble("system", "");
  let toolCount = 0;

  let finalText: string;
  let hitLimit = false;
  try {
    const result = await runToolCallLoop(
      settings, chatMsgs, userParts, tools,
      (tc) => {
        toolCount++;
        const pidx = tc.args.paper_index as number | undefined;
        const pTitle = pidx ? papers[pidx - 1]?.title || `Paper ${pidx}` : "";
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
        toolBubble.innerHTML = `<strong>🔧 Tool #${toolCount}</strong>: ${esc(desc)}`;
        scrollToBottom();
      },
      (_tc, result) => {
        const len = result.length;
        const size = len > 1024 ? `${(len / 1024).toFixed(1)}KB` : `${len} chars`;
        toolBubble.innerHTML += `<br><span style="color:#34a853;">✅ Done (${size})</span>`;
        scrollToBottom();
      },
    );
    finalText = result.text;
    hitLimit = result.hitLimit;
  } catch (e: any) {
    if (toolCount > 0) {
      toolBubble.innerHTML += `<br><span style="color:#ea4335;">❌ Error: ${esc(e?.message || String(e))}</span>`;
    } else {
      toolBubble.remove();
    }
    throw e;
  }

  if (toolCount > 0) {
    let toolSummary = `🔧 Used ${toolCount} tool call(s) to gather additional context.`;
    if (hitLimit) {
      toolSummary += `<br><span style="color:#f9ab00;">⚠️ Tool call limit reached (${settings.maxToolRounds} rounds). AI may not have finished gathering all information. You can increase the limit in Settings → AI Tools → Max Tool Call Rounds.</span>`;
    }
    toolBubble.innerHTML = toolSummary;
  } else {
    toolBubble.remove();
  }

  const modelBubble = addMessageBubble("model", "");
  modelBubble.innerHTML = renderMd(finalText);
  scrollToBottom();

  chatHistory.push({ role: "user", text: userPrompt });
  chatHistory.push({ role: "model", text: finalText });

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

function renderPaperList() {
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
  updateRagStatusIndicators();
}

function init() {
  try { ensureGlobals(); } catch (_e) { /* will fail later with message */ }

  papers = getPapers();
  renderPaperList();

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
  }

  input.focus();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
