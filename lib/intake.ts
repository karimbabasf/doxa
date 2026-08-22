/**
 * Intake rules, in one place so the screen and the route cannot disagree.
 *
 * A person who fixes a length problem the client described must not then be told a
 * different thing by the server, so both sides count the same cleaned string.
 */

export const MIN_WORDS = 3
export const MAX_CHARS = 500

/** Straighten quotes, drop zero width characters, collapse runs of whitespace. */
export function normalise(raw: string): string {
  return raw
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Word count over the cleaned string. An empty string has no words, not one. */
export function countWords(clean: string): number {
  return clean ? clean.split(' ').length : 0
}
