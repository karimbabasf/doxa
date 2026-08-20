/**
 * Every model call in this codebase goes through NEAR AI Cloud.
 *
 * The base URL and the key are read as a pair and both must be present, because
 * a half-configured environment is how a process ends up authenticating against
 * whichever provider happens to have a key in the shell. Nothing here ever reads
 * OPENAI_API_KEY, OPENAI_BASE_URL or ANTHROPIC_API_KEY.
 */
export type NearAiEnv = { baseUrl: string; apiKey: string }

const PAIR_HINT = 'Set NEAR_AI_BASE_URL and NEAR_AI_API_KEY together in .env.local; they are a pair.'

export function getEnv(): NearAiEnv {
  const baseUrl = process.env.NEAR_AI_BASE_URL
  const apiKey = process.env.NEAR_AI_API_KEY
  if (!baseUrl) throw new Error(`NEAR_AI_BASE_URL is not set. ${PAIR_HINT}`)
  if (!apiKey) throw new Error(`NEAR_AI_API_KEY is not set. ${PAIR_HINT}`)
  return { baseUrl, apiKey }
}
