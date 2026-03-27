/**
 * Bounded chat context: keep the last K dialogue turns verbatim, summarize older turns
 * when estimated prompt tokens would exceed the configured budget.
 */

export type DialogMessage = { role: "user" | "model"; text: string };

/**
 * Rough token estimate aware of CJK text.
 * Latin / ASCII: ~4 chars per token.
 * CJK (Chinese, Japanese, Korean): ~1.5 tokens per character.
 * Mixed text: blend of both rates.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Count CJK characters (CJK Unified Ideographs + common CJK ranges)
  let cjkChars = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4DBF) ||   // CJK Unified Ideographs Extension A
      (code >= 0x3000 && code <= 0x303F) ||   // CJK Symbols and Punctuation
      (code >= 0x3040 && code <= 0x309F) ||   // Hiragana
      (code >= 0x30A0 && code <= 0x30FF) ||   // Katakana
      (code >= 0xAC00 && code <= 0xD7AF) ||   // Hangul Syllables
      (code >= 0xFF00 && code <= 0xFFEF)      // Fullwidth Forms
    ) {
      cjkChars++;
    }
  }
  const nonCjkChars = text.length - cjkChars;
  // CJK: ~1.5 tokens per char; non-CJK: ~1 token per 4 chars
  return Math.ceil(cjkChars * 1.5 + nonCjkChars / 4);
}

export function estimateDialogMessagesTokens(msgs: readonly DialogMessage[]): number {
  let t = 0;
  for (const m of msgs) t += estimateTokens(m.text);
  return t;
}

/** Multimodal `parts` arrays (Gemini-style): text + rough allowance for inline PDFs/images. */
export function estimateUserPartsArrayTokens(parts: readonly { text?: string; inlineData?: unknown }[]): number {
  let t = 0;
  for (const p of parts) {
    if (p?.text) t += estimateTokens(String(p.text));
    if (p?.inlineData) t += 8000;
  }
  return t;
}

export function hashMessagesForCache(msgs: readonly DialogMessage[]): string {
  return `${msgs.length}:${msgs.map(m => `${m.role}:${m.text.length}:${m.text.slice(0, 96)}`).join("|")}`;
}

/**
 * Keep the last `recentTurns` rounds. A "round" is user+model; the latest user-only turn
 * (before the assistant reply) counts as one round → keep at most `2 * recentTurns - 1` messages.
 */
export function sliceRecentDialogMessages(
  msgs: readonly DialogMessage[],
  recentTurns: number,
): { older: DialogMessage[]; recent: DialogMessage[] } {
  const k = Math.max(1, recentTurns);
  const maxKeep = 2 * k - 1;
  if (msgs.length <= maxKeep) {
    return { older: [], recent: [...msgs] };
  }
  return {
    older: msgs.slice(0, -maxKeep),
    recent: msgs.slice(-maxKeep),
  };
}

/** Visible to the model when older turns were replaced by a summary (also used to detect compaction in logs). */
export const COMPACTION_SUMMARY_MARKER = "[CONTEXT COMPACTION NOTICE]";

const SUMMARY_PREFIX = `${COMPACTION_SUMMARY_MARKER}
The conversation history has been compressed to fit within the token budget.
IMPORTANT: The older turns have been REMOVED from this conversation and replaced with the summary below. You do NOT have access to the original verbatim text of those older turns. If asked to reproduce earlier dialogue verbatim, you MUST say that the earlier conversation was compressed and you can only provide the summary below.

--- Compressed summary of earlier conversation ---

`;

const SUMMARY_SUFFIX = `

--- End of compressed summary ---
The messages that follow below are the most recent turns kept in full verbatim form.
`;

function truncateToMaxTokens(text: string, maxTokens: number): string {
  const maxChars = Math.max(0, maxTokens * 4);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[…truncated…]`;
}

export type CompactionCache = { summary: string; sourceHash: string };

export async function compactDialogMessagesForRequest(
  dialogMessages: readonly DialogMessage[],
  options: {
    recentTurns: number;
    maxPromptTokens: number;
    extraPromptTokens: number;
    getCache: () => CompactionCache | undefined;
    setCache: (summary: string, sourceHash: string) => void;
    summarizeConversation: (transcript: string) => Promise<string>;
    /** Optional: e.g. `(m) => Zotero.debug(m)` to verify compaction in Help → Debug Output. */
    logDebug?: (msg: string) => void;
  },
): Promise<DialogMessage[]> {
  if (dialogMessages.length === 0) return [];

  /** Remaining token budget for *dialog history* after reserving `extra` (RAG/tools/current turn). */
  const budget = Math.max(0, options.maxPromptTokens - Math.max(0, options.extraPromptTokens));
  const total = estimateDialogMessagesTokens(dialogMessages);
  options.logDebug?.(
    `[ResearchCopilot][contextCompaction] msgs=${dialogMessages.length} est_hist_tokens≈${total} max_prompt=${options.maxPromptTokens} est_extra=${options.extraPromptTokens} hist_budget≈${budget}`,
  );
  if (total <= budget) {
    options.logDebug?.("[ResearchCopilot][contextCompaction] skip: estimated history ≤ budget (no summary).");
    return [...dialogMessages];
  }

  const { older, recent } = sliceRecentDialogMessages(dialogMessages, options.recentTurns);
  if (older.length === 0) {
    options.logDebug?.("[ResearchCopilot][contextCompaction] skip: all history fits in recent K turns (no older segment).");
    return [...recent];
  }

  options.logDebug?.(
    `[ResearchCopilot][contextCompaction] compacting: older_msgs=${older.length} recent_msgs=${recent.length} (recentTurns=${options.recentTurns})`,
  );

  const olderHash = hashMessagesForCache(older);
  let cached = options.getCache();
  let summary = cached?.sourceHash === olderHash ? cached.summary : "";

  if (!summary) {
    const transcript = older
      .map(m => (m.role === "user" ? "User" : "Assistant") + ": " + m.text)
      .join("\n\n");
    const prompt = `You are compressing an earlier segment of a chat so it can continue within a token limit.

Summarize the conversation below. Preserve: key facts, definitions, conclusions, unresolved questions, and any paper/citation names mentioned. Be concise. Use the same language as the conversation.

---
${transcript}
---`;

    try {
      summary = await options.summarizeConversation(prompt);
    } catch (e) {
      summary = "";
      options.logDebug?.(`[ResearchCopilot][contextCompaction] summarizeConversation failed: ${e}`);
    }

    if (summary) {
      const maxSummaryTokens = Math.min(8000, Math.floor(budget / 3));
      summary = truncateToMaxTokens(summary.trim(), maxSummaryTokens);
      options.setCache(summary, olderHash);
    }
  }

  if (!summary) {
    options.logDebug?.("[ResearchCopilot][contextCompaction] summary failed; sending recent turns only.");
    return [...recent];
  }

  const summaryMsg: DialogMessage = {
    role: "user",
    text: SUMMARY_PREFIX + summary + SUMMARY_SUFFIX,
  };

  const merged = [summaryMsg, ...recent];
  if (estimateDialogMessagesTokens(merged) > budget) {
    const over = estimateDialogMessagesTokens(merged) - budget;
    summaryMsg.text = truncateToMaxTokens(summaryMsg.text, Math.max(500, estimateTokens(summaryMsg.text) - over));
  }

  options.logDebug?.(
    `[ResearchCopilot][contextCompaction] done: replaced ${older.length} older message(s) with summary + ${recent.length} recent message(s).`,
  );
  return merged;
}
