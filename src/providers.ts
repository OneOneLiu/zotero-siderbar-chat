/**
 * AI Provider Abstraction Layer
 * 
 * This module provides a unified interface for different AI providers
 * (Gemini, OpenAI, DeepSeek, Doubao) with provider-specific implementations.
 */

export interface AIProvider {
    name: string;
    displayName: string;

    /**
     * Build the API endpoint URL for this provider
     */
    buildEndpoint(settings: ProviderSettings, stream: boolean): string;

    /**
     * Format the request payload according to provider's API spec
     */
    formatRequest(contents: ChatContent[], model: string): any;

    /**
     * Parse streaming response chunks and extract text/metadata
     */
    parseStreamChunk(jsonObj: any): StreamChunk | null;
}

export interface ProviderSettings {
    apiBase: string;
    model: string;
    apiKey: string;
}

export interface ChatContent {
    role: "user" | "model" | "system";
    parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
}

export interface StreamChunk {
    type: "text" | "usage";
    text?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

/**
 * Gemini Provider Implementation
 */
class GeminiProvider implements AIProvider {
    name = "gemini";
    displayName = "Google Gemini";

    buildEndpoint(settings: ProviderSettings, stream: boolean): string {
        const method = stream ? "streamGenerateContent" : "generateContent";
        return `${settings.apiBase}/models/${settings.model}:${method}?key=${settings.apiKey}`;
    }

    formatRequest(contents: ChatContent[], model: string): any {
        // Gemini uses its native format: { contents: [...] }
        return { contents };
    }

    parseStreamChunk(jsonObj: any): StreamChunk | null {
        // Extract text from Gemini's response format
        const text = jsonObj?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
            return { type: "text", text };
        }

        // Extract usage metadata
        if (jsonObj.usageMetadata) {
            return {
                type: "usage",
                usage: {
                    promptTokens: jsonObj.usageMetadata.promptTokenCount,
                    completionTokens: jsonObj.usageMetadata.candidatesTokenCount,
                    totalTokens: jsonObj.usageMetadata.totalTokenCount,
                },
            };
        }

        return null;
    }
}

/**
 * DeepSeek Provider Implementation
 * Uses OpenAI-compatible API
 */
class DeepSeekProvider implements AIProvider {
    name = "deepseek";
    displayName = "DeepSeek";

    buildEndpoint(settings: ProviderSettings, stream: boolean): string {
        return `${settings.apiBase}/chat/completions`;
    }

    formatRequest(contents: ChatContent[], model: string): any {
        // DeepSeek uses OpenAI-compatible format
        const messages = contents.map((content) => {
            const role = content.role === "model" ? "assistant" : content.role;
            const textParts = content.parts.filter((p) => p.text).map((p) => p.text);
            const contentText = textParts.join("\n");
            return { role, content: contentText };
        });

        return {
            model,
            messages,
            stream: true,
        };
    }

    parseStreamChunk(jsonObj: any): StreamChunk | null {
        // DeepSeek uses same format as OpenAI
        const delta = jsonObj?.choices?.[0]?.delta;
        if (delta?.content) {
            return { type: "text", text: delta.content };
        }

        if (jsonObj?.usage) {
            return {
                type: "usage",
                usage: {
                    promptTokens: jsonObj.usage.prompt_tokens,
                    completionTokens: jsonObj.usage.completion_tokens,
                    totalTokens: jsonObj.usage.total_tokens,
                },
            };
        }

        return null;
    }
}

/**
 * Doubao Provider Implementation
 * Uses OpenAI-compatible API
 */
class DoubaoProvider implements AIProvider {
    name = "doubao";
    displayName = "豆包 AI";

    buildEndpoint(settings: ProviderSettings, stream: boolean): string {
        return `${settings.apiBase}/chat/completions`;
    }

    formatRequest(contents: ChatContent[], model: string): any {
        // Doubao uses OpenAI-compatible format
        const messages = contents.map((content) => {
            const role = content.role === "model" ? "assistant" : content.role;
            const textParts = content.parts.filter((p) => p.text).map((p) => p.text);
            const contentText = textParts.join("\n");
            return { role, content: contentText };
        });

        return {
            model,
            messages,
            stream: true,
        };
    }

    parseStreamChunk(jsonObj: any): StreamChunk | null {
        // Doubao uses same format as OpenAI
        const delta = jsonObj?.choices?.[0]?.delta;
        if (delta?.content) {
            return { type: "text", text: delta.content };
        }

        if (jsonObj?.usage) {
            return {
                type: "usage",
                usage: {
                    promptTokens: jsonObj.usage.prompt_tokens,
                    completionTokens: jsonObj.usage.completion_tokens,
                    totalTokens: jsonObj.usage.total_tokens,
                },
            };
        }

        return null;
    }
}

// Provider registry
const providers: Record<string, AIProvider> = {
    gemini: new GeminiProvider(),
    deepseek: new DeepSeekProvider(),
    doubao: new DoubaoProvider(),
};

/**
 * Get provider instance by name
 */
export function getProvider(name: string): AIProvider {
    const provider = providers[name];
    if (!provider) {
        throw new Error(`Unknown provider: ${name}`);
    }
    return provider;
}

/**
 * Get list of all available providers
 */
export function getAllProviders(): AIProvider[] {
    return Object.values(providers);
}
