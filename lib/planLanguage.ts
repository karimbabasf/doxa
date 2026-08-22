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
 * One sentence per tool, for a stranger.
 *
 * The chart is the screen anybody can open, so this is the register it speaks in: what the
 * tool looked at, in words somebody would use out loud. The operator's own blurb is written
 * for the person building the factory and says things like "token frequency against a Zipf
 * reference". Nobody arrives knowing what that is.
 */
const PLAIN_WHAT: Record<string, string> = {
  TOKENIZE: 'Counted the words and how often each one comes back.',
  'CLAIM-EX': 'Pulled out the actual claim being made.',
  MODALITY: 'Measured how strongly it is stated, from "might" to "always".',
  'PARSE-DEPTH': 'Looked at how the sentence is built, and how far it nests.',
  'HEDGE-7': 'Counted the softeners: maybe, sort of, I think.',
  'FK-READ': 'Worked out what reading age it is written for.',
  RHETORIC: 'Looked for the persuasion moves: repetition, contrast, appeals.',
  'VALENCE-ARC': 'Tracked the mood from the first word to the last.',
  'ZIPF-DRIFT': 'Checked how unusual the word choice is against ordinary English.',

  'PRIOR-ART': 'Went out to the web to see whether anyone has said this before.',
  CORROBORATE: 'Went out to the web to find where people argued about it.',
  'DEMO-SHOP': 'Read a live catalogue page to prove the scraper still works.',

  EMBED: 'Turned the meaning into numbers, which is what places it on this chart.',
  'CONTRA-CHK': 'Checked whether it argues against itself.',
  STANCE: 'Worked out which side it takes.',
  'TOPIC-REL': 'Found the opinions nearest to it in meaning.',

  COMPRESS: 'Squeezed the text to see how much of it repeats.',
  ENTROPY: 'Measured how much surprise each letter carries.',
  GEMATRIA: 'Added up the letters as numbers, the old way.',
  'NATAL-CHART': 'Read the sentence as if it had a birth chart.',
  PHONETIC: 'Listened to how blunt or soft it sounds when said out loud.',
  'PRIME-SIG': 'Turned the letter counts into their prime factors.',
}

export function plainWhat(id: string, fallback: string): string {
  return PLAIN_WHAT[id] ?? fallback
}

/**
 * The four groups of tools, said as a stranger would picture them.
 *
 * A name and one line each. The panel shows these four lines and then the tool names, and
 * that is the whole account of the process. Listing every tool's own sentence was tried
 * first and came out as a wall of eighteen paragraphs that nobody would read to the end
 * of, which is a worse answer to "what was done to it" than four lines that land.
 */
export const PLAIN_WING: Record<Wing, { name: string; line: string }> = {
  forensics: {
    name: 'Reading the words',
    line: 'Counting, measuring and taking apart the sentence itself.',
  },
  field: {
    name: 'Checking the web',
    line: 'The only part that leaves this machine and looks at the open web.',
  },
  semantics: {
    name: 'Weighing the meaning',
    line: 'Working out what it means, which side it takes, and what it sits near.',
  },
  esoteric: {
    name: 'The strange readings',
    line: 'Old and odd ways of reading a sentence, kept because they are honest about being odd.',
  },
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
