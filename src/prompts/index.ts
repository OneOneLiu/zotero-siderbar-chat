/**
 * Default prompts loaded from `addon/content/prompts/*.md` at build time (esbuild text loader).
 * Edit those files to change defaults; preferences UI still overrides via Zotero prefs when set.
 */

import questionUnderstanding from "../../addon/content/prompts/question-understanding.md";
import extraction from "../../addon/content/prompts/extraction.md";
import synthesis from "../../addon/content/prompts/synthesis.md";
import followUp from "../../addon/content/prompts/follow-up.md";
import mathFormat from "../../addon/content/prompts/math-format.md";
import standaloneFirstTurn from "../../addon/content/prompts/standalone-first-turn.md";

export const MATH_FORMAT_INSTRUCTION = mathFormat.trim();

export const DEFAULT_QUESTION_UNDERSTANDING_PROMPT = questionUnderstanding.trim();
export const DEFAULT_EXTRACTION_PROMPT = extraction.trim();
export const DEFAULT_SYNTHESIS_PROMPT = synthesis.trim();
export const DEFAULT_FOLLOW_UP_PROMPT = followUp.trim();

export function buildStandaloneFirstTurnPrompt(
  collCtx: string,
  papersStatus: string,
  userPrompt: string,
): string {
  return standaloneFirstTurn
    .trim()
    .replace(/\{collCtx\}/g, collCtx)
    .replace(/\{papers_status\}/g, papersStatus)
    .replace(/\{userPrompt\}/g, userPrompt)
    .replace(/\{math_format\}/g, MATH_FORMAT_INSTRUCTION);
}
