import { config } from "../../package.json";
import { PROVIDERS } from "../constants";

function getPrefKey(key: string) {
  return `${config.prefsPrefix}.${key}`;
}

const DEFAULT_MODELS: Record<string, string> = {
  gemini: "gemini-1.5-flash-latest",
  deepseek: "deepseek-chat",
  doubao: "doubao-seed-1-6-flash-250615",
};

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
      DEFAULT_MODELS[provider] || "gemini-1.5-flash-latest",
    apiKey: (Zotero.Prefs.get(getPrefKey("apiKey"), true) as string) || "",
    customPrompts: (Zotero.Prefs.get(getPrefKey("customPrompts"), true) as string) || "[]",
    chatHeight: parseInt((Zotero.Prefs.get(getPrefKey("chatHeight"), true) as string) || "500", 10),
    /** User-settable; low values (e.g. 900) are for testing compaction — do not clamp to 8k. */
    contextMaxPromptTokens: Math.max(
      500,
      Math.min(2_000_000, parseInt((Zotero.Prefs.get(getPrefKey("contextMaxPromptTokens"), true) as string) || "90000", 10) || 90000),
    ),
    contextRecentTurns: Math.max(1, Math.min(64, parseInt((Zotero.Prefs.get(getPrefKey("contextRecentTurns"), true) as string) || "8", 10) || 8)),
  };
}


