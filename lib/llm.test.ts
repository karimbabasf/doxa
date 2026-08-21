import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chatJson, embed } from './llm'

/**
 * Nothing here talks to a real endpoint. Every case stubs fetch, because the
 * provider key is not in this environment and a test that needs one is a test
 * that gets skipped on the day it matters.
 */

const BASE = 'https://near.example/v1'
const KEY = 'near-key'
const SENTINEL = 'sentinel-openai-key-that-must-never-be-sent'

const saved = { ...process.env }
let fetchMock: ReturnType<typeof vi.fn>

const chatOk = (content: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
})

const httpFail = (status: number, body: string) => ({
  ok: false,
  status,
  text: async () => body,
  json: async () => ({}),
})

beforeEach(() => {
  process.env.LLM_BASE_URL = BASE
  process.env.LLM_API_KEY = KEY
  process.env.LLM_MODEL = 'openai/gpt-oss-120b'
  process.env.LLM_EMBED_MODEL = 'Qwen/Qwen3-Embedding-0.6B'
  // The stray key the shell carries. It must never reach a request.
  process.env.OPENAI_API_KEY = SENTINEL
  process.env.OPENAI_BASE_URL = SENTINEL
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  process.env = { ...saved }
  vi.unstubAllGlobals()
})

const schema = {
  type: 'object',
  properties: { verdict: { type: 'string' } },
  required: ['verdict'],
  additionalProperties: false,
}

describe('chatJson', () => {
  it('posts to the chat endpoint with the configured bearer token', async () => {
    fetchMock.mockResolvedValueOnce(chatOk('{"verdict":"fine"}'))
    await chatJson({ system: 's', user: 'u', schema })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/chat/completions`)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(init.body)
    expect(body.model).toBe('openai/gpt-oss-120b')
    expect(body.temperature).toBe(0)
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'result', schema, strict: true },
    })
    expect(body.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ])
  })

  it('parses the JSON string in the message content', async () => {
    fetchMock.mockResolvedValueOnce(chatOk('{"verdict":"fine","score":3}'))
    const out = await chatJson<{ verdict: string; score: number }>({ system: 's', user: 'u', schema })
    expect(out).toEqual({ verdict: 'fine', score: 3 })
  })

  it('throws with the status code and the response body on a non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(httpFail(400, '{"error":"bad schema"}'))
    await expect(chatJson({ system: 's', user: 'u', schema })).rejects.toThrow(/400/)
    await expect(fetchMock.mock.calls.length).toBe(1)

    fetchMock.mockResolvedValueOnce(httpFail(400, '{"error":"bad schema"}'))
    await expect(chatJson({ system: 's', user: 'u', schema })).rejects.toThrow(/bad schema/)
  })

  it('throws "model returned non-JSON" when the content is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(chatOk('Sure, here is your answer!'))
    await expect(chatJson({ system: 's', user: 'u', schema })).rejects.toThrow(/model returned non-JSON/)
  })

  it('retries once on a 5xx and returns the second response', async () => {
    fetchMock
      .mockResolvedValueOnce(httpFail(503, 'upstream busy'))
      .mockResolvedValueOnce(chatOk('{"verdict":"fine"}'))
    const out = await chatJson<{ verdict: string }>({ system: 's', user: 'u', schema })
    expect(out.verdict).toBe('fine')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after the second 5xx', async () => {
    fetchMock
      .mockResolvedValueOnce(httpFail(500, 'boom'))
      .mockResolvedValueOnce(httpFail(500, 'boom'))
    await expect(chatJson({ system: 's', user: 'u', schema })).rejects.toThrow(/500/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('embed', () => {
  it('posts to the embeddings endpoint and returns one vector per input', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { index: 0, embedding: [0.1, 0.2] },
          { index: 1, embedding: [0.3, 0.4] },
        ],
      }),
    })
    const out = await embed(['one', 'two'])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/embeddings`)
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(init.body)).toEqual({
      model: 'Qwen/Qwen3-Embedding-0.6B',
      input: ['one', 'two'],
    })
    expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]])
  })
})

describe('the stray OPENAI_API_KEY', () => {
  it('never appears in any argument of any fetch call', async () => {
    fetchMock.mockResolvedValue(chatOk('{"verdict":"fine"}'))
    await chatJson({ system: 's', user: 'u', schema })

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ index: 0, embedding: [1] }] }),
    })
    await embed(['one'])

    const seen = JSON.stringify(fetchMock.mock.calls)
    expect(seen).not.toContain(SENTINEL)
    expect(seen).toContain(KEY)
  })
})
