import { describe, expect, it } from 'vitest'
import {
  buildEdges,
  cosineDistance,
  cosineSimilarity,
  nearestNeighbours,
} from './similarity'

describe('cosineSimilarity', () => {
  it('is 1 for the same direction', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1)
  })

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })

  it('is -1 for opposite directions', () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 12)
  })

  it('ignores magnitude, so a non-unit vector scores the same as its unit form', () => {
    expect(cosineSimilarity([3, 4], [6, 8])).toBeCloseTo(1, 12)
  })

  it('refuses a length mismatch rather than comparing a prefix', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(/length mismatch/)
  })

  it('refuses a zero vector, which has no direction to compare', () => {
    expect(() => cosineSimilarity([0, 0], [1, 0])).toThrow(/zero vector/)
  })

  it('refuses an empty vector', () => {
    expect(() => cosineSimilarity([], [])).toThrow(/empty vector/)
  })
})

describe('cosineDistance', () => {
  it('is 0 for the same direction and 1 for orthogonal', () => {
    expect(cosineDistance([1, 0], [1, 0])).toBe(0)
    expect(cosineDistance([1, 0], [0, 1])).toBe(1)
  })
})

describe('nearestNeighbours', () => {
  // Four points on the unit circle. Angles chosen so the neighbour order is obvious
  // by eye: 0 and 1 are 10 degrees apart, 2 sits 90 degrees off, 3 sits opposite.
  const rad = (deg: number) => (deg * Math.PI) / 180
  const onCircle = (deg: number) => [Math.cos(rad(deg)), Math.sin(rad(deg))]
  const vectors = [onCircle(0), onCircle(10), onCircle(90), onCircle(180)]

  it('returns each node its k closest, nearest first', () => {
    const nn = nearestNeighbours(vectors, 2)
    expect(nn[0].map((n) => n.index)).toEqual([1, 2])
    expect(nn[3].map((n) => n.index)).toEqual([2, 1])
  })

  it('never lists a node as its own neighbour', () => {
    for (const [i, list] of nearestNeighbours(vectors, 3).entries()) {
      expect(list.map((n) => n.index)).not.toContain(i)
    }
  })

  it('caps at the number of other nodes when k overshoots', () => {
    expect(nearestNeighbours(vectors, 99)[0]).toHaveLength(3)
  })

  it('refuses k below 1, which would silently draw no graph', () => {
    expect(() => nearestNeighbours(vectors, 0)).toThrow(/at least 1/)
  })

  it('breaks ties on index, so the same input always draws the same graph', () => {
    const tied = [onCircle(0), onCircle(90), onCircle(270)]
    const first = nearestNeighbours(tied, 2)[0].map((n) => n.index)
    const again = nearestNeighbours(tied, 2)[0].map((n) => n.index)
    expect(first).toEqual(again)
    expect(first).toEqual([1, 2])
  })
})

describe('buildEdges', () => {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const onCircle = (deg: number) => [Math.cos(rad(deg)), Math.sin(rad(deg))]

  it('folds a mutual pick into one edge, not two', () => {
    const edges = buildEdges([onCircle(0), onCircle(10)], 1)
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe(0)
    expect(edges[0].target).toBe(1)
  })

  it('orders every edge low index first, so the key cannot duplicate', () => {
    for (const e of buildEdges([onCircle(0), onCircle(10), onCircle(20)], 2)) {
      expect(e.source).toBeLessThan(e.target)
    }
  })

  it('reads strength 1 at zero distance and 0 at the span', () => {
    const same = buildEdges([[1, 0], [1, 0]], 1)
    expect(same[0].distance).toBeCloseTo(0, 12)
    expect(same[0].strength).toBeCloseTo(1, 12)

    const orthogonal = buildEdges([[1, 0], [0, 1]], 1, 1)
    expect(orthogonal[0].distance).toBeCloseTo(1, 12)
    expect(orthogonal[0].strength).toBeCloseTo(0, 12)
  })

  it('never reads a negative strength past the span', () => {
    const opposed = buildEdges([[1, 0], [-1, 0]], 1, 0.6)
    expect(opposed[0].distance).toBeCloseTo(2, 12)
    expect(opposed[0].strength).toBe(0)
  })

  it('drops an incumbent edge when a closer opinion arrives', () => {
    // 0's nearest is 2, forty degrees away.
    const before = buildEdges([onCircle(0), onCircle(120), onCircle(40)], 1)
    expect(before.some((e) => e.source === 0 && e.target === 2)).toBe(true)

    // 3 lands five degrees from 0 and takes the slot. The old edge is gone.
    const after = buildEdges(
      [onCircle(0), onCircle(120), onCircle(40), onCircle(5)],
      1,
    )
    expect(after.some((e) => e.source === 0 && e.target === 3)).toBe(true)
    expect(after.some((e) => e.source === 0 && e.target === 2)).toBe(false)
  })
})
