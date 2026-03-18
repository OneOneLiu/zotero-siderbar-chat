import MarkdownIt from "markdown-it";
// @ts-ignore
import tm from "markdown-it-texmath";
import katex from "katex";
import { config } from "../../package.json";

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
let busy = false;
let savedNoteId: number | null = null;

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
  const mainModel = (Z.Prefs.get(`${pfx}.model`, true) as string) || "gemini-1.5-flash-latest";
  const extractionModelPref = (Z.Prefs.get(`${pfx}.extractionModel`, true) as string) || "__same__";
  const extractionModel = (!extractionModelPref || extractionModelPref === "__same__" || extractionModelPref === "__custom__")
    ? mainModel : extractionModelPref;
  const defaultExtractionPrompt = `The user's research question is:\n"""\n{question}\n"""\n\nBased on this question, read the following paper and extract:\n\n**Part A - Structured extraction** (2-4 sentences each):\n1. **Research Problem**: What problem? Limitations of existing methods?\n2. **Core Contributions**: Main contributions? (1-3)\n3. **Method Overview**: Core method? Key innovation?\n4. **Experimental Results**: Datasets? Key metrics?\n5. **Limitations**: Known limitations?\n6. **Reproducibility**: Code/data available?\n\n**Part B - Relevance to user's question**:\nHighlight parts most relevant to the user's question with specific details.\n\nUse the same language as the user's question.`;

  const defaultSynthesisPrompt = `The user's research question is:\n"""\n{question}\n"""\n\nBelow are structured extractions from {count} paper(s).\n\nProvide a comprehensive analysis answering the user's question:\n\n## 1. Direct Answer\nDirectly address the question with evidence.\n\n## 2. Cross-paper Evidence Summary\nTable comparing each paper (title, method/finding, key data).\n\n## 3. Synthesis & Insights\nConnect findings across papers.\n\n## 4. Gaps & Recommendations\nWhat remains unanswered? Next steps?\n\nUse the same language as the user. Cite which paper evidence comes from.`;

  return {
    provider,
    apiBase: (Z.Prefs.get(`${pfx}.apiBase`, true) as string) || defaultBases[provider] || defaultBases.gemini,
    model: mainModel,
    extractionModel,
    apiKey: (Z.Prefs.get(`${pfx}.apiKey`, true) as string) || "",
    concurrency: Math.max(1, Math.min(8, parseInt(concurrencyStr, 10) || 4)),
    extractionPrompt: (Z.Prefs.get(`${pfx}.extractionPrompt`, true) as string) || defaultExtractionPrompt,
    synthesisPrompt: (Z.Prefs.get(`${pfx}.synthesisPrompt`, true) as string) || defaultSynthesisPrompt,
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
    for (let i = 0; i < u8.byteLength; i += 8192) {
      // @ts-ignore
      bin += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 8192, u8.byteLength)));
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

function getCheckedPaperIds(): number[] {
  const items = document.querySelectorAll(".paper-check-item.selected");
  return Array.from(items).map(el => parseInt((el as HTMLElement).getAttribute("data-paper-id") || "0", 10)).filter(id => id > 0);
}

async function buildContextParts(settings: ReturnType<typeof getSettings>): Promise<any[]> {
  const checkedIds = getCheckedPaperIds();
  const parts: any[] = [];

  if (analysisDoc) {
    parts.push({ text: `[Previous Analysis Summary]\n\n${analysisDoc}` });
  }

  for (const pid of checkedIds) {
    const p = papers.find(pp => pp.id === pid);
    if (!p) continue;
    const zItem = Zotero.Items.get(p.id);
    if (!zItem) continue;
    const pdf = getBestPdfAttachment(zItem);
    if (!pdf) continue;

    if (settings.provider === "gemini") {
      const b64 = await getPdfBase64(pdf);
      if (b64) {
        parts.push({ text: `[Full text: ${p.title}]` });
        parts.push({ inlineData: b64 });
      }
    } else {
      const txt = await getPdfText(pdf);
      if (txt) parts.push({ text: `[Full text: ${p.title}]\n\n${txt}` });
    }
  }
  return parts;
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
  const perPaperPrompt = settings.extractionPrompt.replace(/\{question\}/g, userPrompt);

  const allPdfs: { pdfItem: any; title: string }[] = [];
  for (const p of papers) {
    const z = Zotero.Items.get(p.id);
    if (!z) continue;
    const pdf = getBestPdfAttachment(z);
    if (pdf) allPdfs.push({ pdfItem: pdf, title: p.title });
  }

  if (allPdfs.length === 0) throw new Error("No PDF attachments found.");

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
    let prog = `<strong>Extracting (${CONCURRENCY} concurrent) — ${doneCount}/${allPdfs.length}</strong><br><div style="font-size:11px;color:#888;margin:2px 0 6px;">${modelInfo}</div>`;

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

  // Concurrent pool: run up to CONCURRENCY tasks at once
  const queue = allPdfs.map((_, i) => i);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < CONCURRENCY; w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const idx = queue.shift()!;
        await extractOne(idx);
        await delay(500);
      }
    })());
  }
  await Promise.all(workers);

  analysisDoc = extractions.join("\n\n---\n\n");

  // Save extractions immediately so the work isn't lost if synthesis fails
  chatHistory.push({ role: "user", text: userPrompt });
  await saveAnalysisNote();

  progressBubble.innerHTML = `✅ All ${allPdfs.length} papers extracted. Synthesizing...`;
  scrollToBottom();

  await delay(2000);

  const synthPrompt = settings.synthesisPrompt
    .replace(/\{question\}/g, userPrompt)
    .replace(/\{count\}/g, String(allPdfs.length));

  const synthContents = [{ role: "user" as const, parts: [{ text: analysisDoc + "\n\n---\n\n" + synthPrompt }] }];

  let fullMd = `<details><summary>📋 Per-paper Extractions (click to expand)</summary>\n\n${analysisDoc}\n\n</details>\n\n---\n\n`;
  progressBubble.remove();

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
  const contextParts = await buildContextParts(settings);

  const contents: any[] = [];
  for (const msg of chatHistory) {
    if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.text }] });
    } else if (msg.role === "model") {
      contents.push({ role: "model", parts: [{ text: msg.text }] });
    }
  }

  const userParts: any[] = [...contextParts, { text: userPrompt }];
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
      item.innerHTML = `<span class="paper-check-dot"></span><span class="paper-check-label">${i + 1}. ${esc(p.title)}</span>`;
      item.addEventListener("click", () => {
        item.classList.toggle("selected");
      });
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
    addMessageBubble("system", `${papers.length} paper(s) loaded. Type your research question to start the analysis. Check papers on the left to include their full text in follow-up questions.`);
  }

  input.focus();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
