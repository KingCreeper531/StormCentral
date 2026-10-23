/**
 * The Anthropic API, shared by the Shorts' narration (script.ts) and the
 * live stream's commentary (stream/llm.ts). ANTHROPIC_MODEL picks another
 * model.
 */

export const ANTHROPIC_API = "https://api.anthropic.com/v1";
export const ANTHROPIC_VERSION = "2023-06-01";
/** Fast and cheap: plenty for a few lines of voice-over. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";
