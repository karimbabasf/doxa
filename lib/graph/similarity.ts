/**
 * Semantic distance between two opinions.
 *
 * The graph's whole claim is that the clumping is real: two nodes sit close because
 * the model put their text close, not because a keyword matched. So every number the
 * layout consumes comes from here, and here reads nothing but the embedding vectors
 * EMBED already measured.
 */

/**
 * Cosine similarity of two vectors, in [-1, 1].
 *
 * Provider embeddings arrive unit length, which would make this a plain dot product.
 * It is normalised anyway: a stored vector that drifted off the unit sphere (a truncated
 * write, a different provider, a hand-built fixture) would otherwise silently scale every
 * distance in the graph, and a layout that is quietly wrong is worse than one that throws.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch, ${a.length} vs ${b.length}`)
  }
  if (a.length === 0) throw new Error('cosineSimilarity: empty vector')

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) {
    throw new Error('cosineSimilarity: zero vector has no direction')
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** Cosine distance, in [0, 2]. Zero means the same direction. */
export function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b)
}

export type Neighbour = {
  /** Index into the node array this was computed from. */
  index: number
  distance: number
}

/**
 * The k nearest neighbours of every node, by cosine distance.
 *
 * Why kNN and not "every pair above a threshold": a threshold on real embeddings either
 * connects almost nothing or connects everything to everything, because the distances in
 * one topic bunch tightly and the cut point moves as the graph grows. Taking each node's
 * own k nearest is scale free, keeps the picture readable at any size, and gives the
 * graph its unlinking for free: an arriving opinion that is closer than an incumbent
 * pushes that incumbent out of the top k, so the old edge goes away because the new one
 * is genuinely a better claim, not because anything decayed on a timer.
 */
export function nearestNeighbours(vectors: number[][], k: number): Neighbour[][] {
  if (k < 1) throw new Error('nearestNeighbours: k must be at least 1')

  return vectors.map((self, i) => {
    const scored: Neighbour[] = []
    for (let j = 0; j < vectors.length; j++) {
      if (j === i) continue
      scored.push({ index: j, distance: cosineDistance(self, vectors[j]) })
    }
    // Ties break on index so the same input always draws the same graph.
    scored.sort((x, y) => x.distance - y.distance || x.index - y.index)
    return scored.slice(0, k)
  })
}

export type Edge = {
  source: number
  target: number
  distance: number
  /** 1 at zero distance, falling to 0 at `span`. What the edge's opacity reads from. */
  strength: number
}

/**
 * Fold the kNN lists into one undirected edge set.
 *
 * A picks B and B picks A is one edge, not two. `span` is the distance at which an edge
 * is drawn at zero strength, so it sets how quickly the picture fades from "these two
 * agree" to "these two merely both exist".
 */
export function buildEdges(vectors: number[][], k: number, span = 0.6): Edge[] {
  const neighbours = nearestNeighbours(vectors, k)
  const seen = new Set<string>()
  const edges: Edge[] = []

  neighbours.forEach((list, source) => {
    for (const n of list) {
      const lo = Math.min(source, n.index)
      const hi = Math.max(source, n.index)
      const key = `${lo}:${hi}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({
        source: lo,
        target: hi,
        distance: n.distance,
        strength: Math.max(0, 1 - n.distance / span),
      })
    }
  })

  return edges
}
