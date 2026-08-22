import type { Wing } from './types'

/**
 * The plan, said in the words a person off the street already has.
 *
 * The gate screen is the one screen a stranger reads under time pressure, in a room,
 * over somebody's shoulder. Every name the factory uses internally is a name that
 * costs a sentence of explanation there: operator, instrument, wing, work order, DAG.
 * So this file is the translation layer, and it is the only place the friendly words
 * exist. The ids stay the ids everywhere else.
 *
 * Nothing here is decoration. A judge who asks what CLAIM-EX does gets an answer from
 * the planner's own rationale; this file only fixes what the thing is CALLED.
 */

export type StepId = 'read' | 'web' | 'argue' | 'print'

export type Step = {
  id: StepId
  n: string
  title: string
  line: string
  /** Which wings land in this step. Empty means the step is not made of operators. */
  wings: Wing[]
}

/**
 * Four steps, not twenty two nodes. The real graph has layers and the executor still
 * runs them, but nobody agrees to a plan by reading a dependency graph. These four are
 * the beats a person actually consents to.
 *
 * The web step is second because it is the only one that leaves the machine, and it is
 * the whole reason the rest of the readings can be checked rather than trusted.
 */
export const STEPS: Step[] = [
  {
    id: 'read',
    n: 'STEP 1',
    title: 'Read the sentence',
    line: 'Checks on the words themselves.',
    wings: ['forensics'],
  },
  {
    id: 'web',
    n: 'STEP 2',
    title: 'Check it against the web',
    line: 'The only step that leaves this machine.',
    wings: ['field'],
  },
  {
    id: 'argue',
    n: 'STEP 3',
    title: 'Let the readings argue',
    line: 'They disagree. What came from the web wins.',
    wings: ['semantics', 'esoteric'],
  },
  // TORN OUT 2026-08-22: the print step is the image, and the image is being rebuilt.
  // The gate and the floor both read this list, so the run now signs for and shows three
  // steps. `StepId` keeps 'print' so the screens that branch on it still typecheck.
  // {
  //   id: 'print',
  //   n: 'STEP 4',
  //   title: 'Print it',
  //   line: 'One image nobody else gets, plus a receipt.',
  //   wings: [],
  // },
]

/** Operator id to the name a stranger reads. Anything unlisted falls back to its own name. */
const PLAIN: Record<string, string> = {
  TOKENIZE: 'Word census',
  'CLAIM-EX': 'The claim',
  MODALITY: 'How hard you say it',
  'PARSE-DEPTH': 'Sentence shape',
  'HEDGE-7': 'Hedging',
  'FK-READ': 'Reading level',
  RHETORIC: 'Rhetoric',
  'VALENCE-ARC': 'Mood over the sentence',
  'ZIPF-DRIFT': 'Rare word drift',

  'PRIOR-ART': 'Has anyone said this?',
  CORROBORATE: 'Who argued about it',
  'DEMO-SHOP': 'Catalogue check',

  EMBED: 'Meaning fingerprint',
  'CONTRA-CHK': 'Does it contradict itself',
  STANCE: 'Which side you are on',
  'TOPIC-REL': 'Nearest neighbours',

  COMPRESS: 'How much repeats',
  ENTROPY: 'Surprise per letter',
  GEMATRIA: 'Gematria',
  'NATAL-CHART': 'Natal chart',
  PHONETIC: 'How blunt it sounds',
  'PRIME-SIG': 'Prime signature',
}

export function plainName(id: string, fallback: string): string {
  return PLAIN[id] ?? fallback
}

/**
 * Reading order inside a step, which is the order of the table above.
 *
 * The work order arrives in the planner's order, and only the first three chips are
 * visible. Left alone that buried the meaning fingerprint behind a gematria reading,
 * which is exactly backwards for the three seconds somebody spends looking: the tools
 * that carry the argument go first, the strange ones sit behind the button.
 */
const RANK = new Map(Object.keys(PLAIN).map((id, i) => [id, i]))

export function readingOrder(a: string, b: string): number {
  return (RANK.get(a) ?? Number.MAX_SAFE_INTEGER) - (RANK.get(b) ?? Number.MAX_SAFE_INTEGER)
}

/** How many chips a step shows before the rest go behind one button. */
export const CHIPS_SHOWN = 3

/**
 * Milliseconds as a person would say them out loud. The gate is read by somebody
 * deciding whether to wait, and "138000ms" is not an answer to that question.
 */
export function plainDuration(ms: number): string {
  if (ms < 1000) return 'under a second'
  if (ms < 60_000) {
    const s = Math.round(ms / 1000)
    return `about ${s} second${s === 1 ? '' : 's'}`
  }
  const m = Math.round(ms / 60_000)
  return `about ${m} minute${m === 1 ? '' : 's'}`
}
