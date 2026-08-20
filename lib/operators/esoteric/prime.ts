import { register } from '../registry'
import { type Operator } from '../../types'

/**
 * Two numbers come out of the same text and they do different jobs.
 *
 * The signature is the prime factorisation of the sum of the character codes.
 * It is the reading a person looks at: short, stable, and the same for any
 * rearrangement of the same letters.
 *
 * The seed is a 32-bit FNV-1a hash of the raw opinion, and it is the only value
 * in the system that keys the whole render. It cannot be the code sum, because
 * the code sum is order blind: "abc" and "cba" share it, and two different
 * opinions must never strike the same specimen. FNV-1a reads position as well
 * as content, and it multiplies through `Math.imul`, so it stays inside 32 bits
 * on input of any length instead of drifting into float once a product of
 * character codes passes 2^53.
 */

export function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export type PrimeFactor = { prime: number; exponent: number }

export type Factorisation = {
  factors: PrimeFactor[]
  /** Trial divisions actually performed, not an estimate of them. */
  ops: number
}

/** Trial division by 2, then by odd numbers up to the square root of what is left. */
export function factorise(n: number): Factorisation {
  const factors: PrimeFactor[] = []
  let ops = 0
  let m = n

  if (m < 2) return { factors, ops }

  let twos = 0
  while (m % 2 === 0) {
    m /= 2
    twos += 1
    ops += 1
  }
  if (twos > 0) factors.push({ prime: 2, exponent: twos })

  for (let d = 3; d * d <= m; d += 2) {
    ops += 1
    let exponent = 0
    while (m % d === 0) {
      m /= d
      exponent += 1
      ops += 1
    }
    if (exponent > 0) factors.push({ prime: d, exponent })
  }

  // Whatever survives the sieve above is prime and larger than its own root.
  if (m > 1) factors.push({ prime: m, exponent: 1 })

  return { factors, ops }
}

/** `2 x 3 x 7^2`. The exponent is printed only where it earns its place. */
export function formatSignature(factors: PrimeFactor[], n: number): string {
  if (factors.length === 0) return String(n)
  return factors
    .map((f) => (f.exponent > 1 ? `${f.prime}^${f.exponent}` : String(f.prime)))
    .join(' x ')
}

export const PRIME_SIG: Operator = {
  id: 'PRIME-SIG',
  name: 'Prime signature',
  wing: 'esoteric',
  blurb: 'Breaks the character-code sum into primes, and keys the strike to the exact text.',
  needs: [],
  costUnits: 1,
  estMs: 3,
  estOps: 120,
  touches: ['seed'],
  async run(ctx) {
    let codeSum = 0
    for (let i = 0; i < ctx.opinion.length; i++) codeSum += ctx.opinion.charCodeAt(i)

    const { factors, ops } = factorise(codeSum)
    const largestPrime = factors.length > 0 ? factors[factors.length - 1].prime : 0

    return {
      id: 'PRIME-SIG',
      ops,
      readings: {
        signature: formatSignature(factors, codeSum),
        factorCount: factors.length,
        largestPrime,
      },
      contributions: [
        {
          path: 'seed',
          // Full weight. Nothing else writes the seed, so the merge is uncontested
          // by design and every specimen is keyed to its own text alone.
          value: fnv1a(ctx.opinion),
          weight: 1.0,
        },
      ],
    }
  },
}

register(PRIME_SIG)
