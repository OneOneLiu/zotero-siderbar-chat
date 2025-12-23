import { config } from "../../package.json";

function getPrefKey(key: string) {
  return `${config.prefsPrefix}.${key}`;
}

export function getSettings() {
  return {
    apiBase:
      (Zotero.Prefs.get(getPrefKey("apiBase"), true) as string) ||
      "https://generativelanguage.googleapis.com/v1beta",
    model:
      (Zotero.Prefs.get(getPrefKey("model"), true) as string) ||
      "gemini-1.5-flash-latest",
    apiKey: (Zotero.Prefs.get(getPrefKey("apiKey"), true) as string) || "",
    customPrompts: (Zotero.Prefs.get(getPrefKey("customPrompts"), true) as string) || "[]",
    chatHeight: parseInt((Zotero.Prefs.get(getPrefKey("chatHeight"), true) as string) || "500", 10),
  };
}

export function buildEndpoint(settings: { apiBase: string; model: string; apiKey: string }, stream = false): string {
  const method = stream ? "streamGenerateContent" : "generateContent";
  return `${settings.apiBase}/models/${settings.model}:${method}?key=${settings.apiKey}`;
}

