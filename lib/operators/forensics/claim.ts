import { register } from '../registry'
import { chatJson } from '../../llm'
import type { Operator } from '../../types'

/**
 * The first model call of a run. Everything downstream that needs to know what
 * the person actually asserted (STANCE, the field wing) reads this operator's
 * claim, so it stays deliberately narrow: one assertion, one subject, one
 * verdict on whether the assertion can be checked at all.
 */

const SYSTEM = [
  'You work an assay bench. You are given one opinion written by one person.',
  'Strip the hedging, the rhetoric and the tone, and return the bare assertion underneath.',
  'Keep the writer position: do not soften it, do not argue with it, do not add to it.',
  'Say whether that assertion could be checked against public sources, meaning published',
  'records, documentation, reported numbers or reporting. Taste and preference are not checkable.',
  'Name the single subject entity the assertion is about, as few words as possible.',
].join(' ')

const SCHEMA = {
  type: 'object',
  properties: {
    claim: { type: 'string' },
    checkable: { type: 'boolean' },
    subject: { type: 'string' },
  },
  required: ['claim', 'checkable', 'subject'],
  additionalProperties: false,
}

type ClaimOut = { claim: string; checkable: boolean; subject: string }

export const CLAIM_EX: Operator = {
  id: 'CLAIM-EX',
  name: 'Claim extraction',
  wing: 'forensics',
  blurb: 'Boils the opinion down to the one assertion sitting under the rhetoric.',
  needs: ['TOKENIZE'],
  costUnits: 5,
  estMs: 1200,
  estOps: 600,
  touches: [],
  async run(ctx) {
    const out = await chatJson<ClaimOut>({
      system: SYSTEM,
      user: `Opinion:\n${ctx.opinion}`,
      schema: SCHEMA,
    })
    return {
      id: 'CLAIM-EX',
      // Characters read plus characters written. A long opinion really is more work.
      ops: ctx.opinion.length + out.claim.length + out.subject.length,
      readings: {
        claim: out.claim,
        // readings holds scalars only, so the boolean lands as a word.
        checkable: out.checkable ? 'yes' : 'no',
        subject: out.subject,
      },
    }
  },
}

register(CLAIM_EX)
