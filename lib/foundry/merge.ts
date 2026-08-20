import {
  ALL_RENDER_PATHS,
  INTEGER_PATHS,
  NUMERIC_PATHS,
  WING_WEIGHT,
  type Arrangement,
  type Contribution,
  type FieldType,
  type OperatorResult,
  type RenderParams,
  type RenderPath,
  type Wing,
} from '../types'

/** One operator's claim on one path, kept verbatim so the certificate can quote it. */
export type Contributor = {
  operatorId: string
  value: number | string | boolean
  weight: number
}

/**
 * How a path got its value.
 * `sole`: one operator with a non-zero weight claimed it, so the credit is undivided.
 * `blended`: several claims averaged, so no single assay produced the value.
 * `contested`: several claims on a categorical path, so the heaviest one took it whole.
 */
export type AttributionMode = 'sole' | 'blended' | 'contested'

export type AttributionEntry = {
  contributors: Contributor[]
  dominant: string
  blended: boolean
  mode: AttributionMode
}

export type Attribution = Record<RenderPath, AttributionEntry>

export type MergeOptions = {
  /**
   * Operator id to wing. Breaks a categorical tie by wing order (field, forensics,
   * semantics, esoteric). Without it a tie falls back to operator id, which is stable
   * but arbitrary.
   */
  wings?: Record<string, Wing>
}

export type MergeResult = { params: RenderParams; attribution: Attribution }

const BOOLEAN_PATHS: RenderPath[] = ['frame.bleed']
const MATRIX_SIZES = [2, 4, 8] as const

/**
 * The weight an operator should attach to a contribution: its wing's voice, scaled by how
 * sure it is. A stance detector at confidence 0.5 argues half as loudly as one at 1.
 */
export function weightFor(wing: Wing, confidence = 1): number {
  const clamped = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0
  return WING_WEIGHT[wing] * clamped
}

const isNumeric = (path: RenderPath) => NUMERIC_PATHS.includes(path)
const isBoolean = (path: RenderPath) => BOOLEAN_PATHS.includes(path)

/** Wings sort by how loudly they argue, so the tie-break order comes from WING_WEIGHT itself. */
function wingRank(operatorId: string, wings?: Record<string, Wing>): number {
  const wing = wings?.[operatorId]
  return wing ? -WING_WEIGHT[wing] : 0
}

function byClaimStrength(wings: Record<string, Wing> | undefined) {
  return (a: Contributor, b: Contributor): number => {
    if (a.weight !== b.weight) return b.weight - a.weight
    const rank = wingRank(a.operatorId, wings) - wingRank(b.operatorId, wings)
    if (rank !== 0) return rank
    if (a.operatorId === b.operatorId) return 0
    return a.operatorId < b.operatorId ? -1 : 1
  }
}

function describeBadClaim(operatorId: string, c: Contribution): string | null {
  if (typeof c.weight !== 'number' || !Number.isFinite(c.weight) || c.weight < 0) {
    return `${operatorId} claimed ${c.path} at weight ${String(c.weight)}, expected a finite weight of 0 or more`
  }
  if (isNumeric(c.path) && (typeof c.value !== 'number' || !Number.isFinite(c.value))) {
    return `${operatorId} claimed ${c.path} with ${JSON.stringify(c.value)}, expected a finite number`
  }
  if (isBoolean(c.path) && typeof c.value !== 'boolean') {
    return `${operatorId} claimed ${c.path} with ${JSON.stringify(c.value)}, expected a boolean`
  }
  if (!isNumeric(c.path) && !isBoolean(c.path) && typeof c.value !== 'string') {
    return `${operatorId} claimed ${c.path} with ${JSON.stringify(c.value)}, expected a string`
  }
  return null
}

/** Nearest legal Bayer matrix. A value equidistant from two sizes takes the smaller one. */
function snapMatrix(value: number): 2 | 4 | 8 {
  let best: 2 | 4 | 8 = MATRIX_SIZES[0]
  let bestGap = Math.abs(value - best)
  for (const size of MATRIX_SIZES) {
    const gap = Math.abs(value - size)
    if (gap < bestGap) {
      best = size
      bestGap = gap
    }
  }
  return best
}

/**
 * Fold every operator's contributions into one render parameter vector, and record who
 * shaped each parameter. Numeric paths blend as a weighted mean, everything else goes to
 * the heaviest claim. Throws rather than defaulting: an unclaimed path means the pipeline
 * measured nothing there, and a specimen part built from defaults would misreport itself.
 */
export function mergeContributions(results: OperatorResult[], options: MergeOptions = {}): MergeResult {
  const claims = new Map<RenderPath, Contributor[]>()
  const badClaims: string[] = []

  for (const result of results) {
    for (const c of result.contributions ?? []) {
      const problem = describeBadClaim(result.id, c)
      if (problem) {
        badClaims.push(problem)
        continue
      }
      const list = claims.get(c.path)
      const contributor: Contributor = { operatorId: result.id, value: c.value, weight: c.weight }
      if (list) list.push(contributor)
      else claims.set(c.path, [contributor])
    }
  }

  if (badClaims.length > 0) {
    throw new Error(
      `mergeContributions rejected ${badClaims.length} invalid contribution(s): ${badClaims.join('; ')}.`,
    )
  }

  const unclaimed: RenderPath[] = []
  const zeroWeight: RenderPath[] = []
  const resolved = {} as Record<RenderPath, number | string | boolean>
  const attribution = {} as Attribution
  const compare = byClaimStrength(options.wings)

  for (const path of ALL_RENDER_PATHS) {
    const contributors = (claims.get(path) ?? []).slice().sort(compare)
    if (contributors.length === 0) {
      unclaimed.push(path)
      continue
    }

    const heard = contributors.filter(c => c.weight > 0)
    if (heard.length === 0) {
      zeroWeight.push(path)
      continue
    }

    if (isNumeric(path)) {
      const totalWeight = heard.reduce((sum, c) => sum + c.weight, 0)
      const mean = heard.reduce((sum, c) => sum + (c.value as number) * c.weight, 0) / totalWeight
      resolved[path] =
        path === 'dither.matrix'
          ? snapMatrix(mean)
          : INTEGER_PATHS.includes(path)
            ? Math.round(mean)
            : mean
    } else {
      resolved[path] = heard[0].value
    }

    const blended = heard.length > 1
    attribution[path] = {
      contributors,
      dominant: contributors[0].operatorId,
      blended,
      mode: !blended ? 'sole' : isNumeric(path) ? 'blended' : 'contested',
    }
  }

  if (unclaimed.length > 0 || zeroWeight.length > 0) {
    const parts: string[] = []
    if (unclaimed.length > 0) parts.push(`unclaimed: ${unclaimed.join(', ')}`)
    if (zeroWeight.length > 0) parts.push(`claimed only at zero weight: ${zeroWeight.join(', ')}`)
    throw new Error(
      `mergeContributions found ${unclaimed.length + zeroWeight.length} render path(s) with no usable ` +
        `contribution (${parts.join('; ')}). Every render path must be claimed by an operator, because a ` +
        `specimen part built from defaults misrepresents what was measured.`,
    )
  }

  const params: RenderParams = {
    field: {
      type: resolved['field.type'] as FieldType,
      scale: resolved['field.scale'] as number,
      warpAmp: resolved['field.warpAmp'] as number,
      warpFreq: resolved['field.warpFreq'] as number,
      octaves: resolved['field.octaves'] as number,
    },
    primitives: {
      count: resolved['primitives.count'] as number,
      arrangement: resolved['primitives.arrangement'] as Arrangement,
      sizeBias: resolved['primitives.sizeBias'] as number,
    },
    dither: {
      matrix: resolved['dither.matrix'] as 2 | 4 | 8,
      levels: resolved['dither.levels'] as number,
      contrast: resolved['dither.contrast'] as number,
      bias: resolved['dither.bias'] as number,
    },
    palette: {
      ink: resolved['palette.ink'] as string,
      ground: resolved['palette.ground'] as string,
    },
    frame: {
      fill: resolved['frame.fill'] as number,
      bleed: resolved['frame.bleed'] as boolean,
    },
    seed: resolved['seed'] as number,
  }

  return { params, attribution }
}
