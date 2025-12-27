import { config } from "../../package.json";
import { PROVIDERS } from "../constants";

function getPrefKey(key: string) {
  return `${config.prefsPrefix}.${key}`;
}

export function getSettings() {
  const provider = (Zotero.Prefs.get(getPrefKey("provider"), true) as string) || "gemini";

  // Get default API base for the selected provider
  const providerConfig = PROVIDERS.find(p => p.id === provider);
  const defaultApiBase = providerConfig?.defaultApiBase || "https://generativelanguage.googleapis.com/v1beta";

  return {
    provider,
    apiBase:
      (Zotero.Prefs.get(getPrefKey("apiBase"), true) as string) ||
      defaultApiBase,
    model:
      (Zotero.Prefs.get(getPrefKey("model"), true) as string) ||
      "gemini-1.5-flash-latest",
    apiKey: (Zotero.Prefs.get(getPrefKey("apiKey"), true) as string) || "",
    customPrompts: (Zotero.Prefs.get(getPrefKey("customPrompts"), true) as string) || "[]",
    chatHeight: parseInt((Zotero.Prefs.get(getPrefKey("chatHeight"), true) as string) || "500", 10),
  };
}


