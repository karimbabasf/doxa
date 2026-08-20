import { describe, it, expect } from 'vitest'
import { words, sentences, syllables, letters } from './text'

describe('words', () => {
  it('lowercases and drops punctuation', () => {
    expect(words("Tabs beat spaces, obviously!")).toEqual(['tabs', 'beat', 'spaces', 'obviously'])
  })
  it('keeps internal apostrophes', () => {
    expect(words("it's fine")).toEqual(["it's", 'fine'])
  })
  it('returns an empty array for blank input', () => {
    expect(words('   ')).toEqual([])
  })
})

describe('sentences', () => {
  it('splits on terminal punctuation', () => {
    expect(sentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?'])
  })
  it('treats an unterminated tail as a sentence', () => {
    expect(sentences('One. Two')).toEqual(['One.', 'Two'])
  })
})

describe('syllables', () => {
  it('counts vowel groups', () => {
    expect(syllables('cat')).toBe(1)
    expect(syllables('table')).toBe(2)
    expect(syllables('beautiful')).toBe(3)
  })
  it('never returns zero for a real word', () => {
    expect(syllables('rhythm')).toBeGreaterThanOrEqual(1)
  })
})

describe('letters', () => {
  it('keeps only a to z, lowercased', () => {
    expect(letters('Ab3 c!')).toEqual(['a', 'b', 'c'])
  })
})
