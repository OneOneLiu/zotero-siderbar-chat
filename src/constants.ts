/**
 * Provider configurations
 */
export interface ProviderConfig {
    id: string;
    name: string;
    defaultApiBase: string;
    usesDropdown: boolean; // true = dropdown for models, false = text input
}

export const PROVIDERS: ProviderConfig[] = [
    {
        id: "gemini",
        name: "Google Gemini",
        defaultApiBase: "https://generativelanguage.googleapis.com/v1beta",
        usesDropdown: true,
    },
    {
        id: "deepseek",
        name: "DeepSeek",
        defaultApiBase: "https://api.deepseek.com",
        usesDropdown: false,
    },
    {
        id: "doubao",
        name: "豆包 AI",
        defaultApiBase: "https://ark.cn-beijing.volces.com/api/v3",
        usesDropdown: false,
    },
];

/**
 * Gemini model list (only provider with dropdown)
 */
export const GEMINI_MODELS = [
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-1.5-flash-latest",
];

/**
 * Get provider config by ID
 */
export function getProviderConfig(id: string): ProviderConfig | undefined {
    return PROVIDERS.find((p) => p.id === id);
}
