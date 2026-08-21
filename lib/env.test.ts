import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getEnv } from './env'

const saved = { ...process.env }
beforeEach(() => {
  delete process.env.LLM_BASE_URL
  delete process.env.LLM_API_KEY
})
afterEach(() => {
  process.env = { ...saved }
})

describe('getEnv', () => {
  it('returns the pair when both are set', () => {
    process.env.LLM_BASE_URL = 'https://api.example/v1'
    process.env.LLM_API_KEY = 'k'
    expect(getEnv()).toEqual({ baseUrl: 'https://api.example/v1', apiKey: 'k' })
  })

  it('throws when only the url is set', () => {
    process.env.LLM_BASE_URL = 'https://api.example/v1'
    expect(() => getEnv()).toThrow(/LLM_API_KEY/)
  })

  it('throws when only the key is set', () => {
    process.env.LLM_API_KEY = 'k'
    expect(() => getEnv()).toThrow(/LLM_BASE_URL/)
  })

  it('ignores a stray OPENAI_API_KEY', () => {
    process.env.OPENAI_API_KEY = 'wrong-provider'
    expect(() => getEnv()).toThrow(/LLM_BASE_URL/)
  })

  it('never returns a value sourced from OPENAI_API_KEY', () => {
    process.env.OPENAI_API_KEY = 'wrong-provider'
    process.env.LLM_BASE_URL = 'https://api.example/v1'
    process.env.LLM_API_KEY = 'right-provider'
    expect(getEnv().apiKey).toBe('right-provider')
  })
})
