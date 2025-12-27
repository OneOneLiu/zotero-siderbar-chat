import { config } from "../../package.json";
import { GEMINI_MODELS, PROVIDERS } from "../constants";
import { getProvider } from "../providers";

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

function getInput(id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const el = document.getElementById(id);
  if (!el || (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLSelectElement))) {
    throw new Error(`Missing input ${id}`);
  }
  return el;
}

function initForm(Zotero: any) {
  const providerSelect = getInput("provider") as HTMLSelectElement;
  const apiBase = getInput("api-base") as HTMLInputElement;
  const modelSelect = getInput("model-select") as HTMLSelectElement;
  const modelInput = getInput("model-input") as HTMLInputElement;
  const apiKey = getInput("api-key") as HTMLInputElement;
  const chatHeight = getInput("chat-height") as HTMLInputElement;
  const customPromptsInput = getInput("custom-prompts");
  const promptsList = document.getElementById("prompts-list") as HTMLDivElement;
  const newPromptName = document.getElementById("new-prompt-name") as HTMLInputElement;
  const newPromptText = document.getElementById("new-prompt-text") as HTMLInputElement;
  const addPromptBtn = document.getElementById("add-prompt-btn") as HTMLButtonElement;
  const cancelEditBtn = document.getElementById("cancel-edit-btn") as HTMLButtonElement;

  const status = document.getElementById("test-status") as HTMLDivElement;
  const testBtn = document.getElementById("test-btn") as HTMLButtonElement;

  // Populate providers
  PROVIDERS.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    providerSelect.appendChild(opt);
  });

  // Load selected provider
  const savedProvider = (Zotero.Prefs.get(getPrefKey("provider"), true) as string) || "gemini";
  providerSelect.value = savedProvider;

  // Populate Gemini models
  modelSelect.innerHTML = "";
  GEMINI_MODELS.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    modelSelect.appendChild(opt);
  });

  // Function to update UI based on selected provider
  const updateProviderUI = (isInitialLoad = false) => {
    const selectedProvider = providerSelect.value;
    const providerConfig = PROVIDERS.find(p => p.id === selectedProvider);

    if (!providerConfig) return;

    // When switching providers (not initial load), reset to defaults
    if (!isInitialLoad) {
      // Reset API base to new provider's default
      apiBase.value = providerConfig.defaultApiBase;
      save("apiBase", providerConfig.defaultApiBase);

      // Clear API key when switching providers (different providers need different keys)
      apiKey.value = "";
      save("apiKey", "");
    } else {
      // On initial load, use saved value or default
      apiBase.value = (Zotero.Prefs.get(getPrefKey("apiBase"), true) as string) || providerConfig.defaultApiBase;
    }

    // Show/hide model input based on provider
    if (providerConfig.usesDropdown) {
      // Gemini: Use dropdown
      modelSelect.style.display = "block";
      modelInput.style.display = "none";

      if (!isInitialLoad) {
        // Reset to default Gemini model when switching
        modelSelect.value = "gemini-1.5-flash-latest";
        save("model", "gemini-1.5-flash-latest");
      } else {
        modelSelect.value = (Zotero.Prefs.get(getPrefKey("model"), true) as string) || "gemini-1.5-flash-latest";
      }
    } else {
      // Others: Use text input
      modelSelect.style.display = "none";
      modelInput.style.display = "block";

      if (!isInitialLoad) {
        // Clear model field when switching to a new provider
        modelInput.value = "";
        save("model", "");
      } else {
        modelInput.value = (Zotero.Prefs.get(getPrefKey("model"), true) as string) || "";
      }

      modelInput.placeholder = `Enter model name (e.g., ${selectedProvider === 'deepseek' ? 'deepseek-chat' : 'doubao-model'})`;
    }
  };

  // Initial UI update
  updateProviderUI(true);

  // Update UI when provider changes
  providerSelect.addEventListener("change", () => {
    save("provider", providerSelect.value);
    updateProviderUI(false); // Pass false to reset fields
  });

  apiKey.value = (Zotero.Prefs.get(getPrefKey("apiKey"), true) as string) || "";
  chatHeight.value = (Zotero.Prefs.get(getPrefKey("chatHeight"), true) as string) || "500";

  let prompts: Array<{ name: string, prompt: string }> = [];
  try {
    prompts = JSON.parse((Zotero.Prefs.get(getPrefKey("customPrompts"), true) as string) || "[]");
  } catch (e) {
    prompts = [];
  }
  customPromptsInput.value = JSON.stringify(prompts);

  let editingIndex = -1;

  const save = (id: string, value: string) => {
    Zotero.Prefs.set(getPrefKey(id), value, true);
  };

  const resetForm = () => {
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
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.alignItems = "center";
      row.style.background = "#fff";
      row.style.padding = "6px";
      row.style.borderRadius = "6px";
      row.style.border = "1px solid #d0d7de";

      const name = document.createElement("span");
      name.textContent = p.name;
      name.style.fontWeight = "bold";
      name.style.width = "120px";
      name.style.overflow = "hidden";
      name.style.textOverflow = "ellipsis";
      name.style.whiteSpace = "nowrap";

      const text = document.createElement("span");
      text.textContent = p.prompt;
      text.style.flex = "1";
      text.style.overflow = "hidden";
      text.style.textOverflow = "ellipsis";
      text.style.whiteSpace = "nowrap";
      text.style.color = "#555";

      const actionsDiv = document.createElement("div");
      actionsDiv.style.display = "flex";
      actionsDiv.style.gap = "4px";

      const editBtn = document.createElement("button");
      editBtn.textContent = "✎";
      editBtn.title = "Edit";
      editBtn.style.padding = "2px 6px";
      editBtn.style.color = "#0969da";
      editBtn.style.borderColor = "rgba(27, 31, 36, 0.15)";
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
      delBtn.style.padding = "2px 6px";
      delBtn.style.color = "#cf222e";
      delBtn.style.borderColor = "rgba(27, 31, 36, 0.15)";

      delBtn.onclick = () => {
        if (editingIndex === index) {
          resetForm();
        } else if (editingIndex > index) {
          editingIndex--;
        }
        prompts.splice(index, 1);
        updatePrompts();
      };

      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(delBtn);
      row.appendChild(name);
      row.appendChild(text);
      row.appendChild(actionsDiv);
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
      resetForm();
    } else {
      prompts.push({ name, prompt });
      newPromptName.value = "";
      newPromptText.value = "";
    }
    updatePrompts();
  });

  cancelEditBtn.addEventListener("click", () => {
    resetForm();
  });

  renderPrompts();

  apiBase.addEventListener("change", () => save("apiBase", apiBase.value.trim()));

  // Save model based on which input is visible
  modelSelect.addEventListener("change", () => save("model", modelSelect.value.trim()));
  modelInput.addEventListener("change", () => save("model", modelInput.value.trim()));

  apiKey.addEventListener("change", () => save("apiKey", apiKey.value.trim()));
  chatHeight.addEventListener("change", () => save("chatHeight", chatHeight.value.trim()));
  // customPrompts listener removed as it's handled by updatePrompts

  testBtn.addEventListener("click", async () => {
    status.textContent = "Testing...";
    status.style.color = "#555";
    try {
      const selectedProvider = providerSelect.value;
      const provider = getProvider(selectedProvider);
      const providerConfig = PROVIDERS.find(p => p.id === selectedProvider);

      if (!providerConfig) {
        throw new Error("Invalid provider selected");
      }

      // Get current model value based on input type
      const currentModel = providerConfig.usesDropdown ? modelSelect.value.trim() : modelInput.value.trim();

      if (!currentModel) {
        throw new Error("Please enter a model name");
      }

      // Build endpoint using provider
      const endpoint = provider.buildEndpoint({
        apiBase: apiBase.value.trim(),
        apiKey: apiKey.value.trim(),
        model: currentModel,
      }, false);

      // Format a simple test message
      const testContents = [{
        role: "user" as const,
        parts: [{ text: `Ping from Zotero ${providerConfig.name} Chat preferences.` }]
      }];

      const payload = provider.formatRequest(testContents, currentModel);

      // Prepare headers
      const headers: Record<string, string> = { "Content-Type": "application/json" };

      // OpenAI-compatible providers use Authorization header
      if (selectedProvider !== "gemini") {
        headers["Authorization"] = `Bearer ${apiKey.value.trim()}`;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

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
}

window.addEventListener("DOMContentLoaded", () => {
  const Zotero = getZotero();
  if (!Zotero) {
    const status = document.getElementById("test-status");
    if (status) status.textContent = "Zotero not found. Preferences cannot load.";
    return;
  }
  initForm(Zotero);
});

