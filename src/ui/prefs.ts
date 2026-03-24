import { config } from "../../package.json";
import { PROVIDERS, GEMINI_MODELS, DEEPSEEK_MODELS, DOUBAO_MODELS } from "../constants";
import { getProvider } from "../providers";

interface UserPrefData { id: string; name: string; description: string; prompt: string; }

const DEFAULT_USER_PREFERENCES: UserPrefData[] = [
  {
    id: "tech_route_comparison",
    name: "技术路线深度对比",
    description: "User prefers root-cause and first-principles reasoning when comparing technical approaches; wants logical explanations for why methods work or fail, not empirical effect descriptions",
    prompt: `# 用户偏好：技术路线调研与深度对比

当涉及调研、对比不同技术路线或方法时，请严格遵循以下原则组织回答：

## 1. 问题根因分析
- 必须从最底层的逻辑出发，揭示问题产生的本质原因
- 不要从"效果差"等表面现象出发，要追问"为什么效果差"，直到触及根本机制
- 例如：不要说"传统方法精度低"，而要说"传统方法基于X假设，而该假设在Y条件下不成立，因为..."

## 2. 技术路线的有效性论证
- 对每条技术路线，必须从道理上解释它为什么能解决问题的本质原因
- 如果某技术路线只能解决表层问题而非根因，必须明确指出，并解释其局限性的逻辑原因
- 避免"该方法效果好"这类空泛描述，要说清"该方法通过X机制直接解决了Y这一根因"

## 3. 技术路线间的本质区别
- 对比不同方法时，从逻辑和原理出发，而非从实验效果出发
- 不要说"A比B效果好"，而要说"A和B的本质区别在于对X问题的建模方式不同：A假设...，B假设...，因此..."
- 当指出某方法"不能做某事"时，必须给出逻辑层面的限制原因，而不是简单陈述"不能"
- 尽量避免以计算效率、速度等次要工程因素作为主要对比维度

## 4. 创新洞察的还原
- 当讨论某个方法或技术的优越性时，要尝试还原作者的思考路径：
  - 他们观察到了什么关键现象或矛盾？
  - 为什么之前的研究者没有想到这个方向？之前的思维盲区是什么？
  - 该方法的关键逻辑突破点是什么？
  - 这个洞察为什么是自然且合理的（事后看）？

## 总体原则
始终以"为什么"驱动分析，层层追问因果链，确保每个论断都有逻辑支撑。回答应让读者理解技术演进背后的思维脉络，而不仅仅是技术细节的罗列。`,
  },
];

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

      const testContents = [{ role: "user" as const, parts: [{ text: `Ping from Zotero Research Copilot.` }] }];
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

  // ---- Prompt Editor: Variable Registry ----
  interface PromptVarDef {
    name: string;
    label: string;
    sampleValue: string;
  }
  interface PromptEditorConfig {
    textarea: HTMLTextAreaElement;
    prefKey: string;
    defaultPrompt: string;
    vars: PromptVarDef[];
    tagsContainerId: string;
    validationId: string;
    previewId: string;
    previewDetailsId: string;
    resetBtnId: string;
  }

  const PROMPT_EDITORS: PromptEditorConfig[] = [
    {
      textarea: questionUnderstandingPrompt,
      prefKey: "questionUnderstandingPrompt",
      defaultPrompt: DEFAULT_QUESTION_UNDERSTANDING_PROMPT,
      vars: [
        { name: "question", label: "{question}", sampleValue: "[用户提出的研究问题]" },
        { name: "paper_list", label: "{paper_list}", sampleValue: "[论文1元信息]\n[论文2元信息]\n..." },
        { name: "count", label: "{count}", sampleValue: "3" },
      ],
      tagsContainerId: "var-tags-qu",
      validationId: "validation-qu",
      previewId: "preview-qu",
      previewDetailsId: "preview-details-qu",
      resetBtnId: "reset-question-understanding-prompt",
    },
    {
      textarea: extractionPrompt,
      prefKey: "extractionPrompt",
      defaultPrompt: DEFAULT_EXTRACTION_PROMPT,
      vars: [
        { name: "question", label: "{question}", sampleValue: "[用户提出的研究问题]" },
        { name: "understanding", label: "{understanding}", sampleValue: "[Phase ② 问题理解的输出结果：核心概念定义、子问题 Q1/Q2/Q3...]" },
      ],
      tagsContainerId: "var-tags-ext",
      validationId: "validation-ext",
      previewId: "preview-ext",
      previewDetailsId: "preview-details-ext",
      resetBtnId: "reset-extraction-prompt",
    },
    {
      textarea: synthesisPrompt,
      prefKey: "synthesisPrompt",
      defaultPrompt: DEFAULT_SYNTHESIS_PROMPT,
      vars: [
        { name: "question", label: "{question}", sampleValue: "[用户提出的研究问题]" },
        { name: "understanding", label: "{understanding}", sampleValue: "[Phase ② 问题理解的输出结果]" },
        { name: "extractions", label: "{extractions}", sampleValue: "[Paper 1 提取结果]\n---\n[Paper 2 提取结果]\n---\n..." },
        { name: "count", label: "{count}", sampleValue: "3" },
      ],
      tagsContainerId: "var-tags-synth",
      validationId: "validation-synth",
      previewId: "preview-synth",
      previewDetailsId: "preview-details-synth",
      resetBtnId: "reset-synthesis-prompt",
    },
    {
      textarea: followUpPrompt,
      prefKey: "followUpPrompt",
      defaultPrompt: DEFAULT_FOLLOW_UP_PROMPT,
      vars: [
        { name: "question", label: "{question}", sampleValue: "[用户的追问内容]" },
      ],
      tagsContainerId: "var-tags-followup",
      validationId: "validation-followup",
      previewId: "preview-followup",
      previewDetailsId: "preview-details-followup",
      resetBtnId: "reset-follow-up-prompt",
    },
  ];

  const escPreview = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function insertAtCursor(textarea: HTMLTextAreaElement, text: string) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(end);
    textarea.value = before + text + after;
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function validatePrompt(cfg: PromptEditorConfig) {
    const container = document.getElementById(cfg.validationId);
    if (!container) return;
    container.innerHTML = "";

    const text = cfg.textarea.value;
    const validNames = new Set(cfg.vars.map(v => v.name));
    const allMatches = text.matchAll(/\{(\w+)\}/g);
    const unknownVars: string[] = [];
    const foundVars = new Set<string>();

    for (const m of allMatches) {
      const varName = m[1];
      if (validNames.has(varName)) {
        foundVars.add(varName);
      } else {
        if (!unknownVars.includes(varName)) unknownVars.push(varName);
      }
    }

    if (unknownVars.length > 0) {
      const validList = cfg.vars.map(v => `{${v.name}}`).join(", ");
      const div = document.createElement("div");
      div.className = "validation-warning error";
      div.innerHTML = `<span class="validation-icon">⚠️</span><span>Unknown variable(s): <strong>${unknownVars.map(v => `{${escPreview(v)}}`).join(", ")}</strong> — these will not be replaced at runtime. Valid variables for this prompt: ${validList}</span>`;
      container.appendChild(div);
    }

    const missingVars = cfg.vars.filter(v => !foundVars.has(v.name));
    if (missingVars.length > 0 && text.trim().length > 0) {
      const div = document.createElement("div");
      div.className = "validation-warning info";
      div.innerHTML = `<span class="validation-icon">ℹ️</span><span>Unused variable(s): ${missingVars.map(v => `<strong>{${escPreview(v.name)}}</strong>`).join(", ")} — click the tags above to insert</span>`;
      container.appendChild(div);
    }
  }

  function updatePreview(cfg: PromptEditorConfig) {
    const previewEl = document.getElementById(cfg.previewId);
    const detailsEl = document.getElementById(cfg.previewDetailsId) as HTMLDetailsElement | null;
    if (!previewEl || !detailsEl) return;

    // Only render if details is open
    if (!detailsEl.open) return;

    let text = escPreview(cfg.textarea.value);
    for (const v of cfg.vars) {
      const re = new RegExp(`\\{${v.name}\\}`, "g");
      text = text.replace(re, `<span class="preview-var" title="${escPreview(v.name)}: ${escPreview(v.sampleValue)}">${escPreview(v.sampleValue)}</span>`);
    }
    // Highlight unknown vars with red
    text = text.replace(/\{(\w+)\}/g, (match, name) => {
      return `<span style="background:#ffe0e0;border:1px solid #ff6b6b;border-radius:3px;padding:1px 5px;font-size:11px;color:#d32f2f;font-weight:500;" title="Unknown variable: ${escPreview(name)}">${escPreview(match)}</span>`;
    });
    previewEl.innerHTML = text;
  }

  function renderVarTags(cfg: PromptEditorConfig) {
    const container = document.getElementById(cfg.tagsContainerId);
    if (!container) return;

    for (const v of cfg.vars) {
      const tag = document.createElement("span");
      tag.className = "var-tag";
      tag.innerHTML = `<span class="var-tag-icon">+</span>${escPreview(v.label)}`;
      tag.title = `Click to insert ${v.label}\n→ ${v.sampleValue}`;
      tag.addEventListener("click", () => {
        insertAtCursor(cfg.textarea, v.label);
        // Flash green feedback
        tag.classList.add("var-tag-inserted");
        setTimeout(() => tag.classList.remove("var-tag-inserted"), 600);
      });
      container.appendChild(tag);
    }
  }

  function setupPromptEditor(cfg: PromptEditorConfig) {
    // Render variable tags
    renderVarTags(cfg);

    // Save on input
    cfg.textarea.addEventListener("input", () => {
      save(cfg.prefKey, cfg.textarea.value);
      validatePrompt(cfg);
      updatePreview(cfg);
    });

    // Preview: update when details is toggled open
    const detailsEl = document.getElementById(cfg.previewDetailsId) as HTMLDetailsElement | null;
    if (detailsEl) {
      detailsEl.addEventListener("toggle", () => {
        if (detailsEl.open) updatePreview(cfg);
      });
    }

    // Reset button: also trigger validation & preview update
    $(cfg.resetBtnId).addEventListener("click", () => {
      cfg.textarea.value = cfg.defaultPrompt;
      save(cfg.prefKey, cfg.defaultPrompt);
      validatePrompt(cfg);
      updatePreview(cfg);
    });

    // Initial validation
    validatePrompt(cfg);
  }

  // Initialize all 4 prompt editors
  for (const cfg of PROMPT_EDITORS) {
    setupPromptEditor(cfg);
  }

  // ---- Max Tool Call Rounds ----
  const maxToolRoundsInput = $input("maxToolRounds") as HTMLInputElement;
  maxToolRoundsInput.value = load("maxToolRounds", "100");
  maxToolRoundsInput.addEventListener("change", () => {
    const v = Math.max(1, Math.min(200, parseInt(maxToolRoundsInput.value, 10) || 100));
    maxToolRoundsInput.value = String(v);
    save("maxToolRounds", String(v));
  });

  // ---- AI Tool Toggles ----
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
    const raw = load("enabledTools", "");
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

  // ---- User Preferences ----
  let userPrefs: UserPrefData[] = [];
  try {
    const raw = load("userPreferences", "");
    if (raw) {
      userPrefs = JSON.parse(raw) as UserPrefData[];
    } else {
      userPrefs = [...DEFAULT_USER_PREFERENCES];
      save("userPreferences", JSON.stringify(userPrefs));
    }
  } catch {
    userPrefs = [...DEFAULT_USER_PREFERENCES];
    save("userPreferences", JSON.stringify(userPrefs));
  }

  const prefsList = $("user-prefs-list") as HTMLDivElement;
  const prefIdInput = $("pref-id") as HTMLInputElement;
  const prefNameInput = $("pref-name") as HTMLInputElement;
  const prefDescInput = $("pref-description") as HTMLInputElement;
  const prefPromptInput = $("pref-prompt") as HTMLTextAreaElement;
  const prefAddBtn = $("pref-add-btn") as HTMLButtonElement;
  const prefCancelBtn = $("pref-cancel-btn") as HTMLButtonElement;
  const prefFormTitle = $("pref-form-title") as HTMLDivElement;

  let editingPrefIdx = -1;

  const generatePrefId = (name: string): string => {
    const base = name
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff]/g, "")
      .replace(/[\s]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 30) || "pref";
    const suffix = Date.now().toString(36).slice(-4);
    return `${base}_${suffix}`;
  };

  const saveUserPrefs = () => save("userPreferences", JSON.stringify(userPrefs));

  const resetPrefForm = () => {
    editingPrefIdx = -1;
    prefIdInput.value = "";
    prefNameInput.value = "";
    prefDescInput.value = "";
    prefPromptInput.value = "";
    prefAddBtn.textContent = "Add";
    prefCancelBtn.style.display = "none";
    prefFormTitle.textContent = "Add New Preference";
  };

  const renderUserPrefs = () => {
    prefsList.innerHTML = "";
    userPrefs.forEach((p, index) => {
      const card = document.createElement("div");
      card.className = "pref-card";

      const header = document.createElement("div");
      header.className = "pref-card-header";
      header.innerHTML = `<span class="pref-title">${escHtml(p.name)}</span><span class="pref-id">${escHtml(p.id)}</span>`;

      const desc = document.createElement("div");
      desc.className = "pref-card-desc";
      desc.textContent = p.description;

      const actions = document.createElement("div");
      actions.className = "pref-card-actions";

      const editBtn = document.createElement("button");
      editBtn.textContent = "Edit";
      editBtn.className = "btn-sm";
      editBtn.onclick = () => {
        editingPrefIdx = index;
        prefIdInput.value = p.id;
        prefNameInput.value = p.name;
        prefDescInput.value = p.description;
        prefPromptInput.value = p.prompt;
        prefAddBtn.textContent = "Update";
        prefCancelBtn.style.display = "inline-block";
        prefFormTitle.textContent = "Edit Preference";
      };

      const delBtn = document.createElement("button");
      delBtn.textContent = "Delete";
      delBtn.className = "btn-sm btn-danger";
      delBtn.onclick = () => {
        if (editingPrefIdx === index) resetPrefForm();
        else if (editingPrefIdx > index) editingPrefIdx--;
        userPrefs.splice(index, 1);
        saveUserPrefs();
        renderUserPrefs();
      };

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      card.appendChild(header);
      card.appendChild(desc);
      card.appendChild(actions);
      prefsList.appendChild(card);
    });
  };

  const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  prefAddBtn.addEventListener("click", () => {
    const name = prefNameInput.value.trim();
    const description = prefDescInput.value.trim();
    const prompt = prefPromptInput.value.trim();
    if (!name || !description || !prompt) return;

    if (editingPrefIdx >= 0 && editingPrefIdx < userPrefs.length) {
      const existingId = userPrefs[editingPrefIdx].id;
      userPrefs[editingPrefIdx] = { id: existingId, name, description, prompt };
    } else {
      const id = generatePrefId(name);
      userPrefs.push({ id, name, description, prompt });
    }
    saveUserPrefs();
    renderUserPrefs();
    resetPrefForm();
  });

  prefCancelBtn.addEventListener("click", resetPrefForm);
  renderUserPrefs();
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
