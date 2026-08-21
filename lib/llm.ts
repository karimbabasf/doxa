import { getEnv } from './env'

/**
 * The one client every model call in this codebase goes through. It speaks the
 * OpenAI dialect, which both OpenAI and NEAR AI Cloud serve, and it reads only
 * the LLM_ credential pair. See lib/env.ts for why that matters.
 */

/** Used when LLM_MODEL is unset or empty. */
const DEFAULT_CHAT_MODEL = 'gpt-5.2'
/** Used when LLM_EMBED_MODEL is unset or empty. */
const DEFAULT_EMBED_MODEL = 'text-embedding-3-small'
/** One retry, one wait. A second 5xx means the provider is down, not busy. */
const RETRY_WAIT_MS = 400

export type ChatJsonOpts = {
  system: string
  user: string
  /** JSON Schema for the object you want back. Sent as a strict json_schema response format. */
  schema: object
  model?: string
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Credentials are read here, on every call, never at module load, so a process
 * that starts before .env.local is loaded still fails loudly at the call site
 * and a test can change the environment between cases.
 */
async function postJson(path: string, body: unknown): Promise<unknown> {
  const { baseUrl, apiKey } = getEnv()
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  }

  let lastStatus = 0
  let lastBody = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, init as RequestInit)
    if (res.ok) return await res.json()
    lastStatus = res.status
    lastBody = await res.text().catch(() => '')
    const retryable = res.status >= 500 && attempt === 0
    if (!retryable) break
    await sleep(RETRY_WAIT_MS)
  }
  throw new Error(`Model API ${path} failed with ${lastStatus}: ${lastBody}`)
}

/**
 * One chat call in JSON mode. Returns the parsed object, or throws: a caller that
 * gets prose back has no partial result worth keeping.
 */
export async function chatJson<T>(opts: ChatJsonOpts): Promise<T> {
  const data = (await postJson('/chat/completions', {
    model: opts.model || process.env.LLM_MODEL || DEFAULT_CHAT_MODEL,
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'result', schema: opts.schema, strict: true },
    },
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  })) as { choices?: { message?: { content?: string } }[] }

  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('model returned non-JSON: the response carried no message content')
  }
  try {
    return JSON.parse(content) as T
  } catch {
    throw new Error(`model returned non-JSON: ${content.slice(0, 200)}`)
  }
}

/** One embedding call for a batch of texts. Vectors come back in input order. */
export async function embed(texts: string[], model?: string): Promise<number[][]> {
  const data = (await postJson('/embeddings', {
    model: model || process.env.LLM_EMBED_MODEL || DEFAULT_EMBED_MODEL,
    input: texts,
  })) as { data?: { embedding: number[]; index?: number }[] }

  const rows = data?.data
  if (!Array.isArray(rows)) throw new Error('Model API /embeddings returned no data array')
  return [...rows]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(row => row.embedding)
}
