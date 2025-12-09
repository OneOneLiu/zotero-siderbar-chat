import { config } from "../../package.json";
import { buildEndpoint } from "../modules/settings";

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

function getInput(id: string): HTMLInputElement | HTMLTextAreaElement {
  const el = document.getElementById(id);
  if (!el || (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement))) {
    throw new Error(`Missing input ${id}`);
  }
  return el;
}

function initForm(Zotero: any) {
  const apiBase = getInput("api-base");
  const model = getInput("model");
  const apiKey = getInput("api-key");
  const customPromptsInput = getInput("custom-prompts");
  const promptsList = document.getElementById("prompts-list") as HTMLDivElement;
  const newPromptName = document.getElementById("new-prompt-name") as HTMLInputElement;
  const newPromptText = document.getElementById("new-prompt-text") as HTMLInputElement;
  const addPromptBtn = document.getElementById("add-prompt-btn") as HTMLButtonElement;

  const status = document.getElementById("test-status") as HTMLDivElement;
  const testBtn = document.getElementById("test-btn") as HTMLButtonElement;

  apiBase.value =
    (Zotero.Prefs.get(getPrefKey("apiBase"), true) as string) ||
    "https://generativelanguage.googleapis.com/v1beta";
  model.value =
    (Zotero.Prefs.get(getPrefKey("model"), true) as string) ||
    "gemini-1.5-flash-latest";
  apiKey.value = (Zotero.Prefs.get(getPrefKey("apiKey"), true) as string) || "";
  
  let prompts: Array<{name: string, prompt: string}> = [];
  try {
    prompts = JSON.parse((Zotero.Prefs.get(getPrefKey("customPrompts"), true) as string) || "[]");
  } catch (e) {
    prompts = [];
  }
  customPromptsInput.value = JSON.stringify(prompts);

  const save = (id: string, value: string) => {
    Zotero.Prefs.set(getPrefKey(id), value, true);
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

      const delBtn = document.createElement("button");
      delBtn.textContent = "×";
      delBtn.title = "Remove";
      delBtn.style.padding = "2px 6px";
      delBtn.style.color = "#cf222e";
      delBtn.style.borderColor = "rgba(27, 31, 36, 0.15)";
      
      delBtn.onclick = () => {
        prompts.splice(index, 1);
        updatePrompts();
      };

      row.appendChild(name);
      row.appendChild(text);
      row.appendChild(delBtn);
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
    
    prompts.push({ name, prompt });
    newPromptName.value = "";
    newPromptText.value = "";
    updatePrompts();
  });

  renderPrompts();

  apiBase.addEventListener("change", () => save("apiBase", apiBase.value.trim()));
  model.addEventListener("change", () => save("model", model.value.trim()));
  apiKey.addEventListener("change", () => save("apiKey", apiKey.value.trim()));
  // customPrompts listener removed as it's handled by updatePrompts

  testBtn.addEventListener("click", async () => {
    status.textContent = "Testing...";
    status.style.color = "#555";
    try {
      const endpoint = buildEndpoint({
        apiBase: apiBase.value.trim(),
        apiKey: apiKey.value.trim(),
        model: model.value.trim(),
      });
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Ping from Zotero Gemini Chat preferences." }] }],
        }),
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

