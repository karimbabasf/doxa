import { describe, expect, it } from 'vitest'
import { groupsOf, labelFor } from './clusters'
import type { Edge } from './similarity'

const edge = (source: number, target: number, distance: number): Edge => ({
  source,
  target,
  distance,
  strength: Math.max(0, 1 - distance / 0.6),
})

describe('groupsOf', () => {
  it('joins the close pairs and leaves the far ones apart', () => {
    // Two tight pairs, joined to each other only by one long edge.
    const groups = groupsOf(4, [edge(0, 1, 0.05), edge(2, 3, 0.06), edge(1, 2, 0.9)])
    expect(groups[0]).toBe(groups[1])
    expect(groups[2]).toBe(groups[3])
    expect(groups[0]).not.toBe(groups[2])
  })

  it('gives a node with no close edge a clump of its own', () => {
    const groups = groupsOf(3, [edge(0, 1, 0.04), edge(1, 2, 0.8)])
    expect(new Set(groups).size).toBe(2)
    expect(groups[2]).not.toBe(groups[0])
  })

  it('numbers clumps in node order, so the same graph always reads the same', () => {
    const groups = groupsOf(4, [edge(2, 3, 0.05), edge(0, 1, 0.06)])
    expect(groups).toEqual([0, 0, 1, 1])
  })

  it('leaves a graph of alike distances as one clump instead of splitting on rounding', () => {
    const groups = groupsOf(4, [edge(0, 1, 0.05), edge(1, 2, 0.06), edge(2, 3, 0.07)])
    expect(new Set(groups).size).toBe(1)
  })

  it('gives every node its own clump when there is nothing to join', () => {
    expect(groupsOf(3, [])).toEqual([0, 1, 2])
  })

  it('returns one entry per node', () => {
    expect(groupsOf(5, [edge(0, 1, 0.1)])).toHaveLength(5)
  })
})

describe('labelFor', () => {
  it('names a clump after the word its opinions share', () => {
    expect(
      labelFor([
        'Remote housing policy is broken in this city',
        'Housing costs more than it should anywhere',
        'The housing market never corrects itself',
      ]),
    ).toBe('HOUSING')
  })

  it('ignores a word one opinion repeats to itself', () => {
    expect(
      labelFor(['Bicycles bicycles bicycles bicycles everywhere', 'Trains run late']),
    ).toBe('')
  })

  it('says nothing about a clump of one, because the tile is already the label', () => {
    expect(labelFor(['Housing is broken and housing is expensive'])).toBe('')
  })

  it('skips the words that carry no subject', () => {
    expect(labelFor(['This is what they would think', 'That is what they should think'])).toBe(
      '',
    )
  })

  it('says nothing when the opinions share nothing', () => {
    expect(labelFor(['Coffee tastes burnt', 'Trains arrive late'])).toBe('')
  })
})
