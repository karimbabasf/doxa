import { readFileSync } from 'node:fs'
import path from 'node:path'
import { register } from '../registry'
import { words } from '../../text'
import { WING_WEIGHT } from '../../types'
import type { Operator } from '../../types'

/** Rank a word gets when it is not in the top ten thousand at all. */
const UNKNOWN_RARITY = 10

/** Function words carry no rarity signal, so they are read only when nothing else is. */
const STOPWORDS = new Set([
  'a', 'about', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be',
  'because', 'been', 'but', 'by', 'can', 'did', 'do', 'does', 'for', 'from', 'had',
  'has', 'have', 'he', 'her', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is',
  'it', 'its', 'just', 'me', 'more', 'most', 'my', 'no', 'nor', 'not', 'of', 'on',
  'only', 'or', 'other', 'our', 'out', 'over', 'own', 'same', 'she', 'should', 'so',
  'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'to', 'too', 'up', 'us', 'very', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'who', 'will', 'with', 'would', 'you', 'your',
])

/**
 * Word to zero-based frequency rank, read once at module load. The list is the
 * google-10000-english corpus, checked in under `data/`.
 */
const RANKS: Map<string, number> = loadRanks()

function loadRanks(): Map<string, number> {
  const file = path.join(process.cwd(), 'data', 'google-10000-english.txt')
  const lines = readFileSync(file, 'utf8').split('\n')
  const map = new Map<string, number>()
  let rank = 0
  for (const line of lines) {
    const word = line.trim()
    if (!word) continue
    if (!map.has(word)) map.set(word, rank)
    rank += 1
  }
  return map
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export const ZIPF_DRIFT: Operator = {
  id: 'ZIPF-DRIFT',
  name: 'Vocabulary rarity drift',
  wing: 'forensics',
  blurb: 'Ranks the vocabulary against the ten thousand commonest English words.',
  needs: [],
  costUnits: 1,
  estMs: 6,
  estOps: 140,
  touches: ['primitives.sizeBias'],
  async run(ctx) {
    const w = words(ctx.opinion)
    // A text made of nothing but function words still has a rarity, so when the
    // filter empties the list the whole text becomes the content.
    const filtered = w.filter((token) => !STOPWORDS.has(token))
    const content = filtered.length > 0 ? filtered : w

    let unknown = 0
    let total = 0
    for (const token of content) {
      const rank = RANKS.get(token)
      if (rank === undefined) {
        unknown += 1
        total += UNKNOWN_RARITY
      } else {
        total += Math.log10(rank + 10)
      }
    }

    const meanRarity = content.length ? total / content.length : 0
    const unknownRatio = content.length ? unknown / content.length : 0
    const value = clamp((meanRarity - 2) / 8, 0, 1)

    return {
      id: 'ZIPF-DRIFT',
      // One stopword check per token, then one rank lookup per content word.
      ops: w.length + content.length,
      readings: { meanRarity, unknownRatio },
      contributions: [
        { path: 'primitives.sizeBias', value, weight: WING_WEIGHT.forensics * 0.7 },
      ],
      notes: [`${content.length} content words, ${unknown} outside the top ten thousand`],
    }
  },
}

register(ZIPF_DRIFT)
