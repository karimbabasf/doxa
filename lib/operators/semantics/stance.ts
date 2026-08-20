import { register } from '../registry'
import { chatJson } from '../../llm'
import { WING_WEIGHT } from '../../types'
import type { Contribution, Ctx, Operator } from '../../types'

/**
 * Reads which side of its own claim the writer is on. It works from the claim
 * CLAIM-EX extracted rather than the raw opinion, because the rhetoric that makes
 * a stance hard to read is exactly what CLAIM-EX already stripped out.
 *
 * The frame bleeds only for a writer who is for their own claim. Everything else
 * keeps its margin, and the model's own confidence decides how loudly it argues.
 */

const SYSTEM = [
  'You work an assay bench. You are given one assertion, taken from an opinion one person wrote.',
  'Say whether that person is for the assertion, against it, or mixed about it.',
  'For means they endorse it. Against means they reject it. Mixed means they hold both at once.',
  'Then rate how clear that reading is, from 0 for a guess to 1 for stated outright.',
  'Judge the writer position only. Do not say whether the assertion is true.',
].join(' ')

const STANCES = ['for', 'against', 'mixed'] as const
type Stance = (typeof STANCES)[number]

const SCHEMA = {
  type: 'object',
  properties: {
    stance: { type: 'string', enum: [...STANCES] },
    confidence: { type: 'number' },
  },
  required: ['stance', 'confidence'],
  additionalProperties: false,
}

type StanceOut = { stance: string; confidence: number }

function readClaim(ctx: Ctx): string {
  const result = ctx.results.get('CLAIM-EX')
  if (!result) {
    throw new Error('STANCE has nothing to read: CLAIM-EX has not run. It belongs in `needs`.')
  }
  const claim = result.readings.claim
  if (typeof claim !== 'string' || claim.trim().length === 0) {
    throw new Error('STANCE has nothing to read: CLAIM-EX returned an empty claim.')
  }
  return claim
}

export const STANCE: Operator = {
  id: 'STANCE',
  name: 'Stance detection',
  wing: 'semantics',
  blurb: 'Decides whether the writer is for, against or mixed about their own claim.',
  needs: ['CLAIM-EX'],
  costUnits: 4,
  estMs: 900,
  estOps: 300,
  touches: ['frame.bleed'],
  async run(ctx) {
    const claim = readClaim(ctx)
    const out = await chatJson<StanceOut>({
      system: SYSTEM,
      user: `Assertion:\n${claim}\n\nAs written by:\n${ctx.opinion}`,
      schema: SCHEMA,
    })

    if (!(STANCES as readonly string[]).includes(out.stance)) {
      throw new Error(
        `STANCE got the stance "${out.stance}", which is not one of ${STANCES.join(', ')}.`,
      )
    }
    const stance = out.stance as Stance
    // A model that reports 4 out of 1 would otherwise outshout every other operator.
    const confidence = Math.min(1, Math.max(0, Number(out.confidence) || 0))

    const contributions: Contribution[] = [
      {
        path: 'frame.bleed',
        // Only a writer who is for their own claim earns the edge. Mixed keeps its margin.
        value: stance === 'for',
        // The confidence scaling the spec calls for, and the reason Task 10 can trust it.
        weight: WING_WEIGHT.semantics * confidence,
      },
    ]

    return {
      id: 'STANCE',
      // Characters read plus characters written.
      ops: claim.length + ctx.opinion.length + stance.length,
      readings: { stance, confidence },
      contributions,
    }
  },
}

register(STANCE)
