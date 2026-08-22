/**
 * The face of one opinion.
 *
 * Every run leaves a pile of numbers behind: how long the sentence is, how hedged it is,
 * how it scores on a dozen readings nobody would read for pleasure. This turns that pile
 * into a small square picture, so a person can tell two runs apart at a glance and a room
 * full of them reads as a population rather than a list.
 *
 * The rules it holds itself to:
 *
 * - **Nothing is decorative.** Every value below is derived from what the run measured.
 *   No random seed, no clock, no batch id sprinkled in for variety. Two runs that measured
 *   the same numbers get the same face, and that is a claim worth being able to make.
 * - **It is a grid of whole cells, never a picture.** The face is drawn as blocks that are
 *   either off, dithered, or solid, so it survives being drawn small. A smooth image drawn
 *   small turns to grey mud, which is exactly the bug that cost this build two days.
 * - **It is pure.** No react, no next, no canvas. The renderer draws what this returns.
 */

/** Cells per side. Odd, so the face has a centre to be symmetric about. */
export const FACE_SIZE = 9

/**
 * The hue band every face is drawn in. The dither kit's green sits at 145 and this is the
 * stretch either side of it that still reads as the same colour across a room.
 */
export const HUE_LOW = 128
export const HUE_HIGH = 168

/** How dark a cell is: 0 off, 1 and 2 dithered, 3 solid. */
export type Tone = 0 | 1 | 2 | 3

export type Face = {
  /** Row-major, `FACE_SIZE * FACE_SIZE` long. */
  cells: Tone[]
  /** 0 to 360. The colour the whole face is drawn in. */
  hue: number
  /** Share of cells that carry any ink at all, 0 to 1. Reported, not an input. */
  ink: number
}

export type FaceInput = {
  /**
   * Every number the run measured, in the order the tools reported them. Readings that
   * are words rather than numbers are left out by the caller: a word has no size to read.
   */
  numbers: number[]
  /** How many tools reported at all. A run that did more work carries a denser face. */
  tools: number
}

/**
 * 32-bit FNV-1a. The same recipe the dither kit hashes with, kept here rather than
 * imported so this file stays free of anything that touches the browser.
 */
function fnv1a(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** xorshift32. Deterministic, small, and good enough to scatter cells convincingly. */
function xorshift32(seed: number): () => number {
  let s = seed || 0x9e3779b9
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0x100000000
  }
}

/**
 * The run's numbers, boiled down to one 32-bit value.
 *
 * Rounded to six decimals first, because a float that differs in its last bit between two
 * machines would otherwise draw a different face for the same measurement.
 */
export function digest(numbers: number[]): number {
  const text = numbers
    .filter((n) => Number.isFinite(n))
    .map((n) => n.toFixed(6))
    .join(',')
  return fnv1a(text.length > 0 ? text : 'nothing was measured')
}

/**
 * Draw the face for one run.
 *
 * The shape is mirrored left to right. A symmetric mark reads as a thing rather than as
 * noise, which is the whole difference between an identity and a smudge, and it costs
 * half the cells to decide.
 */
export function faceFor(input: FaceInput): Face {
  const seed = digest(input.numbers)
  const rand = xorshift32(seed)

  // One colour family, not a wheel.
  //
  // The first cut of this walked the whole hue circle and the chart came out as a bag of
  // sweets: magenta beside cyan beside yellow. Colour that varies that hard reads as a
  // label, so a viewer starts asking what the pink ones have in common, and the answer is
  // nothing. Shape is the identity here and position is the meaning. So the hue stays
  // inside one band around the kit's green, wide enough that two faces are never the same
  // print and narrow enough that the whole population reads as one species.
  const hue = HUE_LOW + (seed % (HUE_HIGH - HUE_LOW))

  // More tools reporting means more ink. The range is set so a real run lands in the
  // middle of it: the floor keeps a one tool run from being a blank square, and the
  // ceiling keeps a busy run from filling in, because the holes are what make a face a
  // shape rather than a block.
  const fill = Math.max(0.2, Math.min(0.5, 0.2 + (input.tools / 22) * 0.26))

  const half = Math.ceil(FACE_SIZE / 2)
  const cells: Tone[] = new Array<Tone>(FACE_SIZE * FACE_SIZE).fill(0)

  for (let y = 0; y < FACE_SIZE; y++) {
    for (let x = 0; x < half; x++) {
      const roll = rand()
      let tone: Tone = 0
      if (roll < fill * 0.42) tone = 3
      else if (roll < fill * 0.74) tone = 2
      else if (roll < fill) tone = 1

      cells[y * FACE_SIZE + x] = tone
      cells[y * FACE_SIZE + (FACE_SIZE - 1 - x)] = tone
    }
  }

  const lit = cells.filter((c) => c > 0).length
  return { cells, hue, ink: lit / cells.length }
}

/**
 * The numbers a stored run offers up, ready for {@link faceFor}.
 *
 * Kept beside the generator because the two have to agree: if the caller ever picked the
 * readings differently the faces would drift, and a face that changes for a run that did
 * not is a lie about what it is showing.
 */
export function numbersOf(
  results: { readings: Record<string, number | string> }[],
): number[] {
  return results.flatMap((r) =>
    Object.values(r.readings).filter((v): v is number => typeof v === 'number'),
  )
}
