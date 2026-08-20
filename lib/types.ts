export type Wing = 'forensics' | 'semantics' | 'esoteric' | 'field'

/**
 * How loudly each wing argues when two operators claim the same render parameter.
 * Field work outranks everything because it is the only reading backed by outside
 * evidence; the esoteric wing is deliberately the quietest voice in the room.
 */
export const WING_WEIGHT: Record<Wing, number> = {
  field: 1.0,
  forensics: 0.8,
  semantics: 0.7,
  esoteric: 0.5,
}

export type FieldType = 'bloom' | 'collapse' | 'lattice' | 'fracture'
export type Arrangement = 'radial' | 'grid' | 'spiral' | 'scatter'

export type RenderParams = {
  field: { type: FieldType; scale: number; warpAmp: number; warpFreq: number; octaves: number }
  primitives: { count: number; arrangement: Arrangement; sizeBias: number }
  dither: { matrix: 2 | 4 | 8; levels: number; contrast: number; bias: number }
  palette: { ink: string; ground: string }
  frame: { fill: number; bleed: boolean }
  seed: number
}

export type RenderPath =
  | 'field.type'
  | 'field.scale'
  | 'field.warpAmp'
  | 'field.warpFreq'
  | 'field.octaves'
  | 'primitives.count'
  | 'primitives.arrangement'
  | 'primitives.sizeBias'
  | 'dither.matrix'
  | 'dither.levels'
  | 'dither.contrast'
  | 'dither.bias'
  | 'palette.ink'
  | 'palette.ground'
  | 'frame.fill'
  | 'frame.bleed'
  | 'seed'

export const ALL_RENDER_PATHS: RenderPath[] = [
  'field.type', 'field.scale', 'field.warpAmp', 'field.warpFreq', 'field.octaves',
  'primitives.count', 'primitives.arrangement', 'primitives.sizeBias',
  'dither.matrix', 'dither.levels', 'dither.contrast', 'dither.bias',
  'palette.ink', 'palette.ground',
  'frame.fill', 'frame.bleed',
  'seed',
]

/** Paths that blend as a weighted mean. Everything else takes the heaviest single claim. */
export const NUMERIC_PATHS: RenderPath[] = [
  'field.scale', 'field.warpAmp', 'field.warpFreq', 'field.octaves',
  'primitives.count', 'primitives.sizeBias',
  'dither.matrix', 'dither.levels', 'dither.contrast', 'dither.bias',
  'frame.fill', 'seed',
]

/** Numeric paths that must land on a whole number. */
export const INTEGER_PATHS: RenderPath[] = [
  'field.octaves', 'primitives.count', 'dither.matrix', 'dither.levels', 'seed',
]

export type Contribution = {
  path: RenderPath
  value: number | string | boolean
  weight: number
}

export type Evidence = {
  source: string
  url: string
  snippet: string
  retrievedAt: string
  supports: boolean
}

export type OperatorResult = {
  id: string
  /** Real operation count, not an estimate. Feeds the live counter on the floor. */
  ops: number
  readings: Record<string, number | string>
  evidence?: Evidence[]
  contributions?: Contribution[]
  notes?: string[]
}

export type Ctx = {
  opinion: string
  batchId: string
  results: Map<string, OperatorResult>
}

export type Operator = {
  id: string
  name: string
  wing: Wing
  blurb: string
  /** Operator ids whose results this one reads. Doubles as the executor's DAG. */
  needs: string[]
  costUnits: number
  estMs: number
  estOps: number
  /** Render paths this operator is allowed to write. Doubles as the attribution map. */
  touches: RenderPath[]
  run(ctx: Ctx): Promise<OperatorResult>
}

export type WorkOrder = {
  batchId: string
  opinion: string
  operators: { id: string; rationale: string; enabled: boolean }[]
  estCostUnits: number
  estMs: number
  estOps: number
  plannerNotes: string
  createdAt: string
}
