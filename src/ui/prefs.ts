import { config } from "../../package.json";
import { PROVIDERS, GEMINI_MODELS, DEEPSEEK_MODELS, DOUBAO_MODELS } from "../constants";
import { getProvider } from "../providers";

const DEFAULT_EXTRACTION_PROMPT = `The user's research question is:
"""
{question}
"""

Based on this question, read the following paper and extract:

**Part A - Structured extraction** (2-4 sentences each):
1. **Research Problem**: What problem? Limitations of existing methods?
2. **Core Contributions**: Main contributions? (1-3)
3. **Method Overview**: Core method? Key innovation?
4. **Experimental Results**: Datasets? Key metrics?
5. **Limitations**: Known limitations?
6. **Reproducibility**: Code/data available?

**Part B - Relevance to user's question**:
Highlight parts most relevant to the user's question with specific details.

Use the same language as the user's question.`;

const DEFAULT_SYNTHESIS_PROMPT = `The user's research question is:
"""
{question}
"""

Below are structured extractions from {count} paper(s).

Provide a comprehensive analysis answering the user's question:

## 1. Direct Answer
Directly address the question with evidence.

## 2. Cross-paper Evidence Summary
Table comparing each paper (title, method/finding, key data).

## 3. Synthesis & Insights
Connect findings across papers.

## 4. Gaps & Recommendations
What remains unanswered? Next steps?

Use the same language as the user. Cite which paper evidence comes from.`;

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
  const extractionPrompt = $input("extraction-prompt") as HTMLTextAreaElement;
  const synthesisPrompt = $input("synthesis-prompt") as HTMLTextAreaElement;

  extractionPrompt.value = load("extractionPrompt", DEFAULT_EXTRACTION_PROMPT);
  synthesisPrompt.value = load("synthesisPrompt", DEFAULT_SYNTHESIS_PROMPT);

  extractionPrompt.addEventListener("input", () => save("extractionPrompt", extractionPrompt.value));
  synthesisPrompt.addEventListener("input", () => save("synthesisPrompt", synthesisPrompt.value));

  $("reset-extraction-prompt").addEventListener("click", () => {
    extractionPrompt.value = DEFAULT_EXTRACTION_PROMPT;
    save("extractionPrompt", DEFAULT_EXTRACTION_PROMPT);
  });
  $("reset-synthesis-prompt").addEventListener("click", () => {
    synthesisPrompt.value = DEFAULT_SYNTHESIS_PROMPT;
    save("synthesisPrompt", DEFAULT_SYNTHESIS_PROMPT);
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
