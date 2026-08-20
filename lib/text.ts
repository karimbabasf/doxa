/**
 * Text primitives shared by the whole forensics wing. Deterministic and dependency
 * free, so every operator that reads an opinion reads it the same way.
 */

/**
 * Lowercased word tokens. Apostrophes survive inside a word ("it's") but never on
 * an edge, so a quoted word does not become a different token from its bare form.
 */
export function words(s: string): string[] {
  const matches = s.toLowerCase().match(/[a-z']+/g)
  if (!matches) return []
  return matches.map((w) => w.replace(/^'+|'+$/g, '')).filter((w) => w.length > 0)
}

/** Sentences, split on terminal punctuation. An unterminated tail still counts. */
export function sentences(s: string): string[] {
  return s
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
}

/**
 * Vowel group count, with a trailing silent `e` removed first. Not a dictionary
 * lookup, so it is wrong on some words, but it is wrong the same way every run,
 * which is what the readability operators need.
 */
export function syllables(word: string): number {
  let w = word.toLowerCase()
  if (w.length > 3 && w.endsWith('e') && !w.endsWith('le')) w = w.slice(0, -1)
  const groups = w.match(/[aeiouy]+/g)
  return Math.max(1, groups ? groups.length : 0)
}

/** Lowercased a to z only. Digits, punctuation and whitespace are dropped. */
export function letters(s: string): string[] {
  return s.toLowerCase().match(/[a-z]/g) ?? []
}
