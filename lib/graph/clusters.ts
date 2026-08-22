/**
 * The clumps, and what to call them.
 *
 * The chart already puts opinions about the same thing near each other, because the springs
 * rest at the distance between their meanings. What it did not do was say so. A stranger
 * looking at a field of tiles cannot tell whether a clump means anything, so the clump gets
 * a name and the name is read off the opinions inside it.
 *
 * Nothing here invents a category. The groups are components of the same nearest neighbour
 * edges the layout is already built on, cut where those distances jump, and the
 * name is the word those opinions actually share. If they share nothing, there is no name.
 */

import type { Edge } from './similarity'

/**
 * Which clump each opinion belongs to, as an index per node.
 *
 * The cut is where the distances jump, not a fixed number of edges and not a fixed distance.
 * Real embeddings bunch: inside a subject the distances sit close together, and the step up
 * to "these two merely both exist" is a visible gap in the sorted list. Cutting at the gap
 * works the same whether there are twelve opinions or two hundred, and it leaves a graph
 * whose distances are all alike as one clump, which is the true answer for a set of
 * opinions that are all about one thing.
 *
 * `minGap` is the floor under what counts as a jump. Without it, a graph of near-identical
 * distances would be split at the largest rounding difference between them.
 */
export function groupsOf(count: number, edges: Edge[], minGap = 0.06): number[] {
  const parent = Array.from({ length: count }, (_, i) => i)

  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }

  if (edges.length > 0) {
    const sorted = [...edges].sort((a, b) => a.distance - b.distance)

    let cut = sorted.length
    let widest = minGap
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].distance - sorted[i - 1].distance
      if (gap > widest) {
        widest = gap
        cut = i
      }
    }

    for (const edge of sorted.slice(0, cut)) {
      const a = find(edge.source)
      const b = find(edge.target)
      if (a !== b) parent[a] = b
    }
  }

  // Renumbered in node order so the same graph always names its clumps the same way.
  const seen = new Map<number, number>()
  return Array.from({ length: count }, (_, i) => {
    const root = find(i)
    const known = seen.get(root)
    if (known !== undefined) return known
    const next = seen.size
    seen.set(root, next)
    return next
  })
}

/**
 * Words that carry no subject. Dropped before counting, because otherwise every clump on
 * the chart is called THE.
 */
const NOISE = new Set([
  'about', 'after', 'again', 'against', 'almost', 'already', 'also', 'always', 'anything',
  'because', 'been', 'before', 'being', 'better', 'between', 'both', 'cannot', 'could',
  'does', 'doing', 'done', 'dont', 'down', 'each', 'else', 'enough', 'even', 'ever',
  'every', 'from', 'gets', 'getting', 'give', 'going', 'good', 'have', 'having', 'here',
  'however', 'into', 'itself', 'just', 'keep', 'know', 'least', 'less', 'like', 'little',
  'long', 'looks', 'make', 'makes', 'many', 'maybe', 'mean', 'means', 'might', 'more',
  'most', 'much', 'must', 'need', 'needs', 'never', 'next', 'nothing', 'often', 'once',
  'only', 'other', 'over', 'own', 'people', 'perhaps', 'probably', 'quite', 'rather',
  'really', 'right', 'same', 'says', 'seem', 'seems', 'should', 'since', 'some',
  'something', 'still', 'such', 'sure', 'take', 'than', 'that', 'their', 'them', 'then',
  'there', 'these', 'they', 'thing', 'things', 'think', 'this', 'those', 'though',
  'through', 'time', 'together', 'took', 'toward', 'true', 'under', 'until', 'upon',
  'used', 'using', 'very', 'want', 'well', 'were', 'what', 'when', 'where', 'which',
  'while', 'will', 'with', 'without', 'work', 'would', 'your',

  // The short ones. Same job, listed apart because the list is long and dull.
  'am', 'an', 'and', 'any', 'are', 'as', 'at', 'bad', 'be', 'but', 'by', 'can', 'did', 'do',
  'far', 'for', 'get', 'had', 'has', 'her', 'him', 'his', 'how', 'if', 'in', 'is', 'it',
  'its', 'let', 'lot', 'me', 'my', 'new', 'no', 'not', 'now', 'of', 'off', 'old', 'on',
  'one', 'or', 'our', 'out', 'own', 'per', 'put', 'saw', 'say', 'see', 'she', 'so', 'the',
  'to', 'too', 'two', 'up', 'us', 'use', 'was', 'way', 'we', 'who', 'why', 'yet', 'you',
])

/**
 * The words of one opinion, lowercased, with the ones that carry no subject dropped.
 *
 * Two letters is the floor, not four. The shortest words are usually noise and they are
 * listed as noise, but some of them are the entire subject: a clump of opinions about AI
 * called ITSELF because AI was too short to count is the chart failing at the one job the
 * title has.
 */
function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]+/g) ?? [])
    .map((w) => w.replace(/'s$/, ''))
    .filter((w) => w.length >= 2 && !NOISE.has(w))
}

/**
 * The name of a clump, from the opinions in it.
 *
 * Scored on how many of the opinions use the word, not on how often it is said, because a
 * word repeated four times in one sentence describes that sentence and a word used once in
 * each of four sentences describes the clump. A clump of one gets no name: a title over a
 * single tile is a label, and the tile is already the label.
 */
export function labelFor(texts: string[]): string {
  if (texts.length < 2) return ''

  const shared = new Map<string, number>()
  const total = new Map<string, number>()
  for (const text of texts) {
    const words = wordsOf(text)
    for (const word of new Set(words)) shared.set(word, (shared.get(word) ?? 0) + 1)
    for (const word of words) total.set(word, (total.get(word) ?? 0) + 1)
  }

  let best = ''
  let bestShared = 0
  let bestTotal = 0
  for (const [word, count] of shared) {
    const seen = total.get(word) ?? 0
    // Ties break on the word itself so the same clump always reads the same.
    const better =
      count > bestShared ||
      (count === bestShared && seen > bestTotal) ||
      (count === bestShared && seen === bestTotal && word < best)
    if (better) {
      best = word
      bestShared = count
      bestTotal = seen
    }
  }

  // A word only one opinion uses is that opinion talking, not the clump.
  if (bestShared < 2) return ''
  return best.toUpperCase()
}
