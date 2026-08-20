import { gzipSync, constants } from 'node:zlib'
import { register } from '../registry'
import { WING_WEIGHT, type Operator } from '../../types'

/**
 * How much of the opinion is repetition. Gzip finds repeated runs and phrases
 * and stores each one once, so the ratio of compressed bytes to raw bytes is a
 * direct reading of how much of the text says something it has not said yet.
 * A repetitive line compresses small and gets few octaves of field detail; a
 * dense line barely compresses at all and gets the full stack.
 *
 * The level is pinned. Gzip output length depends on the compression level, and
 * an unpinned level would let the same opinion strike two different specimens.
 */

const GZIP_LEVEL = constants.Z_BEST_COMPRESSION

const MIN_OCTAVES = 2
const MAX_OCTAVES = 6

export const COMPRESS: Operator = {
  id: 'COMPRESS',
  name: 'Compression ratio',
  wing: 'esoteric',
  blurb: 'Squeezes the raw text to see how much of it repeats itself.',
  needs: [],
  costUnits: 1,
  estMs: 6,
  estOps: 400,
  touches: ['field.octaves'],
  async run(ctx) {
    const raw = Buffer.from(ctx.opinion, 'utf8')
    const rawBytes = raw.length
    const packed = gzipSync(raw, { level: GZIP_LEVEL })

    // An empty opinion has nothing to compress, and its gzip envelope is not a ratio.
    const gzipRatio = rawBytes > 0 ? packed.length / rawBytes : 0

    const octaves = Math.min(
      MAX_OCTAVES,
      Math.max(MIN_OCTAVES, Math.round(2 + gzipRatio * 4)),
    )

    return {
      id: 'COMPRESS',
      // Bytes read in, bytes written out.
      ops: rawBytes + packed.length,
      readings: {
        gzipRatio,
        rawBytes,
      },
      contributions: [
        {
          path: 'field.octaves',
          value: octaves,
          // The quietest claim in the wing. PARSE-DEPTH writes this path too and
          // it reads real syntax, so the merge should hear it first.
          weight: WING_WEIGHT.esoteric * 0.5,
        },
      ],
    }
  },
}

register(COMPRESS)
