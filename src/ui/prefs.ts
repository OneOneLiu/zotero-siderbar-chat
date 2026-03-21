import { config } from "../../package.json";
import { PROVIDERS, GEMINI_MODELS, DEEPSEEK_MODELS, DOUBAO_MODELS } from "../constants";
import { getProvider } from "../providers";

const DEFAULT_QUESTION_UNDERSTANDING_PROMPT = `# Role: 资深学术研究助理

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

const DEFAULT_EXTRACTION_PROMPT = `# Role: 学术文献信息萃取专家

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

const DEFAULT_SYNTHESIS_PROMPT = `# Role: 多文献交叉分析与综合专家

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

const DEFAULT_FOLLOW_UP_PROMPT = `# Role: 基于多文献分析的学术追问助理

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

function getZotero(): any {
  const w = window as any;
  return (
    w.Zotero ||
    w.opener?.Zotero ||
    w.parent?.Zotero ||
    (w.arguments && w.arguments[0]?.Zotero)
  );
}

function getPrefKey(key: string) {
  return `${config.prefsPrefix}.${key}`;
}

function $(id: string) {
  return document.getElementById(id)!;
}

function $input(id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const el = document.getElementById(id);
  if (!el || (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLSelectElement))) {
    throw new Error(`Missing input ${id}`);
  }
  return el;
}

function initTabs() {
  const btns = document.querySelectorAll(".tab-btn");
  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      btns.forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const tabId = (btn as HTMLElement).getAttribute("data-tab");
      $(`tab-${tabId}`).classList.add("active");
    });
  });
}

function initForm(Zotero: any) {
  const save = (id: string, value: string) => {
    Zotero.Prefs.set(getPrefKey(id), value, true);
  };
  const load = (id: string, fallback = ""): string => {
    return (Zotero.Prefs.get(getPrefKey(id), true) as string) || fallback;
  };

  // ---- Basic Settings ----
  const providerSelect = $input("provider") as HTMLSelectElement;
  const apiBase = $input("api-base") as HTMLInputElement;
  const modelSelect = $input("model-select") as HTMLSelectElement;
  const modelInput = $input("model-input") as HTMLInputElement;
  const apiKey = $input("api-key") as HTMLInputElement;
  const chatHeight = $input("chat-height") as HTMLInputElement;

  PROVIDERS.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    providerSelect.appendChild(opt);
  });
  providerSelect.value = load("provider", "gemini");

  const getModelsForProvider = (provider: string): string[] => {
    if (provider === "gemini") return GEMINI_MODELS;
    if (provider === "deepseek") return DEEPSEEK_MODELS;
    if (provider === "doubao") return DOUBAO_MODELS;
    return [];
  };

  const getDefaultModel = (provider: string): string => {
    if (provider === "gemini") return "gemini-1.5-flash-latest";
    if (provider === "deepseek") return "deepseek-chat";
    if (provider === "doubao") return "doubao-seed-1-6-flash-250615";
    return "";
  };

  const populateDropdown = (select: HTMLSelectElement, models: string[], addSame = false, addCustom = true) => {
    select.innerHTML = "";
    if (addSame) {
      const o = document.createElement("option");
      o.value = "__same__";
      o.textContent = "Same as main model";
      select.appendChild(o);
    }
    models.forEach(m => {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      select.appendChild(o);
    });
    if (addCustom) {
      const o = document.createElement("option");
      o.value = "__custom__";
      o.textContent = "Custom...";
      select.appendChild(o);
    }
  };

  const setupModelPair = (
    select: HTMLSelectElement,
    input: HTMLInputElement,
    prefKey: string,
    provider: string,
    isInitialLoad: boolean,
    addSame = false,
  ) => {
    const models = getModelsForProvider(provider);
    populateDropdown(select, models, addSame);

    const saved = load(prefKey, addSame ? "__same__" : getDefaultModel(provider));
    const allVals = Array.from(select.options).map((o: HTMLOptionElement) => o.value);

    if (saved && !allVals.includes(saved) && saved !== "__custom__") {
      select.value = "__custom__";
      input.value = saved;
      select.style.display = "block";
      input.style.display = "block";
    } else if (saved === "__custom__") {
      select.value = "__custom__";
      select.style.display = "block";
      input.style.display = "block";
    } else {
      select.value = saved;
      select.style.display = "block";
      input.style.display = "none";
      if (!isInitialLoad) {
        const def = addSame ? "__same__" : getDefaultModel(provider);
        select.value = def;
        save(prefKey, def);
      }
    }
  };

  const wireModelPair = (select: HTMLSelectElement, input: HTMLInputElement, prefKey: string) => {
    select.addEventListener("change", () => {
      if (select.value === "__custom__") {
        input.style.display = "block";
        input.focus();
        save(prefKey, input.value || "");
      } else {
        input.style.display = "none";
        save(prefKey, select.value);
      }
    });
    input.addEventListener("input", () => save(prefKey, input.value));
  };

  // ---- Extraction model ----
  const extractModelSelect = $input("extraction-model-select") as HTMLSelectElement;
  const extractModelInput = $input("extraction-model-input") as HTMLInputElement;

  const updateProviderUI = (isInitialLoad = false) => {
    const provider = providerSelect.value;
    const cfg = PROVIDERS.find(p => p.id === provider);
    if (!cfg) return;

    if (!isInitialLoad) {
      apiBase.value = cfg.defaultApiBase;
      save("apiBase", cfg.defaultApiBase);
      apiKey.value = "";
      save("apiKey", "");
    } else {
      apiBase.value = load("apiBase", cfg.defaultApiBase);
    }

    setupModelPair(modelSelect, modelInput, "model", provider, isInitialLoad);
    setupModelPair(extractModelSelect, extractModelInput, "extractionModel", provider, isInitialLoad, true);
  };

  updateProviderUI(true);

  wireModelPair(modelSelect, modelInput, "model");
  wireModelPair(extractModelSelect, extractModelInput, "extractionModel");

  providerSelect.addEventListener("change", () => {
    save("provider", providerSelect.value);
    updateProviderUI(false);
  });

  apiKey.value = load("apiKey");
  chatHeight.value = load("chatHeight", "500");
  apiBase.addEventListener("change", () => save("apiBase", apiBase.value.trim()));
  apiKey.addEventListener("change", () => save("apiKey", apiKey.value.trim()));
  chatHeight.addEventListener("change", () => save("chatHeight", chatHeight.value.trim()));

  // ---- Test connection ----
  const testBtn = $("test-btn") as HTMLButtonElement;
  const status = $("test-status") as HTMLDivElement;
  testBtn.addEventListener("click", async () => {
    status.textContent = "Testing...";
    status.style.color = "#555";
    try {
      const selectedProvider = providerSelect.value;
      const provider = getProvider(selectedProvider);
      const providerConfig = PROVIDERS.find(p => p.id === selectedProvider);
      if (!providerConfig) throw new Error("Invalid provider selected");

      const currentModel = providerConfig.usesDropdown
        ? (modelSelect.value === "__custom__" ? modelInput.value.trim() : modelSelect.value.trim())
        : modelInput.value.trim();
      if (!currentModel) throw new Error("Please enter a model name");

      const endpoint = provider.buildEndpoint({
        apiBase: apiBase.value.trim(),
        apiKey: apiKey.value.trim(),
        model: currentModel,
      }, false);

      const testContents = [{ role: "user" as const, parts: [{ text: `Ping from Zotero Sidebar Chat.` }] }];
      const payload = provider.formatRequest(testContents, currentModel);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (selectedProvider !== "gemini") headers["Authorization"] = `Bearer ${apiKey.value.trim()}`;

      const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${res.statusText}: ${text}`);
      }
      status.textContent = "OK";
      status.style.color = "#2e7d32";
    } catch (e: any) {
      status.textContent = `Failed: ${e?.message || e}`;
      status.style.color = "#b3261e";
    }
  });

  // ---- Concurrency ----
  const concurrency = $input("concurrency") as HTMLSelectElement;
  concurrency.value = load("concurrency", "4");

  // ---- RAG Settings ----
  const ragPerPaper = $input("rag-per-paper") as HTMLSelectElement;
  const ragChunks = $input("rag-chunks") as HTMLSelectElement;
  ragPerPaper.value = load("ragMaxChunksPerPaper", "3");
  ragChunks.value = load("ragChunksPerQuery", "30");
  ragPerPaper.addEventListener("change", () => save("ragMaxChunksPerPaper", ragPerPaper.value));
  ragChunks.addEventListener("change", () => save("ragChunksPerQuery", ragChunks.value));
  concurrency.addEventListener("change", () => save("concurrency", concurrency.value));

  // ---- Custom Quick Prompts ----
  const customPromptsInput = $input("custom-prompts");
  const promptsList = $("prompts-list") as HTMLDivElement;
  const newPromptName = $("new-prompt-name") as HTMLInputElement;
  const newPromptText = $("new-prompt-text") as HTMLInputElement;
  const addPromptBtn = $("add-prompt-btn") as HTMLButtonElement;
  const cancelEditBtn = $("cancel-edit-btn") as HTMLButtonElement;

  let prompts: Array<{ name: string; prompt: string }> = [];
  try { prompts = JSON.parse(load("customPrompts", "[]")); } catch (_) { prompts = []; }
  customPromptsInput.value = JSON.stringify(prompts);
  let editingIndex = -1;

  const resetPromptForm = () => {
    editingIndex = -1;
    newPromptName.value = "";
    newPromptText.value = "";
    addPromptBtn.textContent = "Add";
    cancelEditBtn.style.display = "none";
  };

  const renderPrompts = () => {
    promptsList.innerHTML = "";
    prompts.forEach((p, index) => {
      const row = document.createElement("div");
      row.className = "prompt-row";

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = p.name;

      const text = document.createElement("span");
      text.className = "text";
      text.textContent = p.prompt;

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "4px";

      const editBtn = document.createElement("button");
      editBtn.textContent = "✎";
      editBtn.title = "Edit";
      editBtn.className = "btn-sm btn-link";
      editBtn.onclick = () => {
        editingIndex = index;
        newPromptName.value = p.name;
        newPromptText.value = p.prompt;
        addPromptBtn.textContent = "Update";
        cancelEditBtn.style.display = "inline-block";
      };

      const delBtn = document.createElement("button");
      delBtn.textContent = "×";
      delBtn.title = "Remove";
      delBtn.className = "btn-sm btn-danger";
      delBtn.onclick = () => {
        if (editingIndex === index) resetPromptForm();
        else if (editingIndex > index) editingIndex--;
        prompts.splice(index, 1);
        updatePrompts();
      };

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      row.appendChild(name);
      row.appendChild(text);
      row.appendChild(actions);
      promptsList.appendChild(row);
    });
  };

  const updatePrompts = () => {
    const json = JSON.stringify(prompts);
    customPromptsInput.value = json;
    save("customPrompts", json);
    renderPrompts();
  };

  addPromptBtn.addEventListener("click", () => {
    const name = newPromptName.value.trim();
    const prompt = newPromptText.value.trim();
    if (!name || !prompt) return;
    if (editingIndex >= 0 && editingIndex < prompts.length) {
      prompts[editingIndex] = { name, prompt };
      resetPromptForm();
    } else {
      prompts.push({ name, prompt });
      newPromptName.value = "";
      newPromptText.value = "";
    }
    updatePrompts();
  });
  cancelEditBtn.addEventListener("click", resetPromptForm);
  renderPrompts();

  // ---- Analysis Prompts ----
  const questionUnderstandingPrompt = $input("question-understanding-prompt") as HTMLTextAreaElement;
  const extractionPrompt = $input("extraction-prompt") as HTMLTextAreaElement;
  const synthesisPrompt = $input("synthesis-prompt") as HTMLTextAreaElement;
  const followUpPrompt = $input("follow-up-prompt") as HTMLTextAreaElement;

  questionUnderstandingPrompt.value = load("questionUnderstandingPrompt", DEFAULT_QUESTION_UNDERSTANDING_PROMPT);
  extractionPrompt.value = load("extractionPrompt", DEFAULT_EXTRACTION_PROMPT);
  synthesisPrompt.value = load("synthesisPrompt", DEFAULT_SYNTHESIS_PROMPT);
  followUpPrompt.value = load("followUpPrompt", DEFAULT_FOLLOW_UP_PROMPT);

  questionUnderstandingPrompt.addEventListener("input", () => save("questionUnderstandingPrompt", questionUnderstandingPrompt.value));
  extractionPrompt.addEventListener("input", () => save("extractionPrompt", extractionPrompt.value));
  synthesisPrompt.addEventListener("input", () => save("synthesisPrompt", synthesisPrompt.value));
  followUpPrompt.addEventListener("input", () => save("followUpPrompt", followUpPrompt.value));

  $("reset-question-understanding-prompt").addEventListener("click", () => {
    questionUnderstandingPrompt.value = DEFAULT_QUESTION_UNDERSTANDING_PROMPT;
    save("questionUnderstandingPrompt", DEFAULT_QUESTION_UNDERSTANDING_PROMPT);
  });
  $("reset-extraction-prompt").addEventListener("click", () => {
    extractionPrompt.value = DEFAULT_EXTRACTION_PROMPT;
    save("extractionPrompt", DEFAULT_EXTRACTION_PROMPT);
  });
  $("reset-synthesis-prompt").addEventListener("click", () => {
    synthesisPrompt.value = DEFAULT_SYNTHESIS_PROMPT;
    save("synthesisPrompt", DEFAULT_SYNTHESIS_PROMPT);
  });
  $("reset-follow-up-prompt").addEventListener("click", () => {
    followUpPrompt.value = DEFAULT_FOLLOW_UP_PROMPT;
    save("followUpPrompt", DEFAULT_FOLLOW_UP_PROMPT);
  });

  // ---- Max Tool Call Rounds ----
  const maxToolRoundsInput = $input("maxToolRounds") as HTMLInputElement;
  maxToolRoundsInput.value = load("maxToolRounds", "15");
  maxToolRoundsInput.addEventListener("change", () => {
    const v = Math.max(1, Math.min(100, parseInt(maxToolRoundsInput.value, 10) || 15));
    maxToolRoundsInput.value = String(v);
    save("maxToolRounds", String(v));
  });

  // ---- AI Tool Toggles ----
  const ALL_TOOL_NAMES = [
    "load_paper_fulltext", "rag_deep_search", "get_paper_metadata",
    "get_item_notes", "get_item_annotations",
    "list_collections", "list_collection_items", "search_library",
    "get_items_by_tag", "list_tags",
    "remove_paper", "add_paper_to_analysis", "rebuild_paper_rag",
  ];

  let enabledTools: Set<string>;
  try {
    const raw = load("enabledTools", "");
    enabledTools = raw ? new Set(JSON.parse(raw) as string[]) : new Set(ALL_TOOL_NAMES);
  } catch {
    enabledTools = new Set(ALL_TOOL_NAMES);
  }

  const syncToolCheckboxes = () => {
    for (const name of ALL_TOOL_NAMES) {
      const cb = document.getElementById(`tool-${name}`) as HTMLInputElement | null;
      if (cb) cb.checked = enabledTools.has(name);
    }
  };

  const saveToolPrefs = () => {
    save("enabledTools", JSON.stringify([...enabledTools]));
  };

  syncToolCheckboxes();

  for (const name of ALL_TOOL_NAMES) {
    const cb = document.getElementById(`tool-${name}`) as HTMLInputElement | null;
    if (cb) {
      cb.addEventListener("change", () => {
        if (cb.checked) enabledTools.add(name);
        else enabledTools.delete(name);
        saveToolPrefs();
      });
    }
  }

  $("tools-select-all").addEventListener("click", () => {
    for (const name of ALL_TOOL_NAMES) enabledTools.add(name);
    syncToolCheckboxes();
    saveToolPrefs();
  });

  $("tools-select-none").addEventListener("click", () => {
    enabledTools.clear();
    syncToolCheckboxes();
    saveToolPrefs();
  });
}

window.addEventListener("DOMContentLoaded", () => {
  initTabs();
  const Zotero = getZotero();
  if (!Zotero) {
    const status = document.getElementById("test-status");
    if (status) status.textContent = "Zotero not found. Preferences cannot load.";
    return;
  }
  initForm(Zotero);
});
