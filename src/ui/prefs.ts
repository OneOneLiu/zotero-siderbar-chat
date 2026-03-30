import { config } from "../../package.json";
import { PROVIDERS, GEMINI_MODELS, DEEPSEEK_MODELS, DOUBAO_MODELS } from "../constants";
import { getProvider } from "../providers";
import {
  DEFAULT_EXTRACTION_PROMPT,
  DEFAULT_FOLLOW_UP_PROMPT,
  DEFAULT_QUESTION_UNDERSTANDING_PROMPT,
  DEFAULT_SYNTHESIS_PROMPT,
} from "../prompts";

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
  const contextMaxTokens = $input("context-max-tokens") as HTMLInputElement;
  const contextRecentTurns = $input("context-recent-turns") as HTMLInputElement;

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
  contextMaxTokens.value = load("contextMaxPromptTokens", "90000");
  contextRecentTurns.value = load("contextRecentTurns", "8");
  apiBase.addEventListener("change", () => save("apiBase", apiBase.value.trim()));
  apiKey.addEventListener("change", () => save("apiKey", apiKey.value.trim()));
  chatHeight.addEventListener("change", () => save("chatHeight", chatHeight.value.trim()));
  contextMaxTokens.addEventListener("change", () => save("contextMaxPromptTokens", contextMaxTokens.value.trim()));
  contextRecentTurns.addEventListener("change", () => save("contextRecentTurns", contextRecentTurns.value.trim()));

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

      const testContents = [{ role: "user" as const, parts: [{ text: `Ping from ${config.uiName}.` }] }];
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
