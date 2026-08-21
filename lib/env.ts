/**
 * Every model call in this codebase goes through one OpenAI-compatible provider,
 * whichever one LLM_BASE_URL names. It is OpenAI today.
 *
 * The base URL and the key are read as a pair and both must be present, because
 * a half-configured environment is how a process ends up authenticating against
 * whichever provider happens to have a key in the shell. Nothing here ever reads
 * OPENAI_API_KEY, OPENAI_BASE_URL or ANTHROPIC_API_KEY.
 */
export type LlmEnv = { baseUrl: string; apiKey: string }

const PAIR_HINT = 'Set LLM_BASE_URL and LLM_API_KEY together in .env.local; they are a pair.'

export function getEnv(): LlmEnv {
  const baseUrl = process.env.LLM_BASE_URL
  const apiKey = process.env.LLM_API_KEY
  if (!baseUrl) throw new Error(`LLM_BASE_URL is not set. ${PAIR_HINT}`)
  if (!apiKey) throw new Error(`LLM_API_KEY is not set. ${PAIR_HINT}`)
  return { baseUrl, apiKey }
}
