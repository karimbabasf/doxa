/**
 * The factory's capability list.
 *
 * Importing this module is what puts operators in the registry. Each operator file
 * calls `register()` for itself at import time, so this file only has to pull all
 * twenty one of them in; calling `register` again here would throw on a duplicate id,
 * which is the registry doing its job.
 *
 * Nothing else triggers registration, so any entry point that plans or runs a batch
 * has to import this module once, or `allOperators()` comes back empty and the
 * planner composes a pipeline out of nothing. The app layer owns that import.
 * `lib/planner` deliberately does not, because a planner that reaches for a global
 * registry cannot be unit tested against a fixture set.
 *
 * Four wings: forensics 9, semantics 4, esoteric 6, field 2.
 */
import { TOKENIZE } from './forensics/tokenize'
import { HEDGE_7 } from './forensics/hedge'
import { VALENCE_ARC } from './forensics/valence'
import { FK_READ } from './forensics/readability'
import { PARSE_DEPTH } from './forensics/parseDepth'
import { CLAIM_EX } from './forensics/claim'
import { MODALITY } from './forensics/modality'
import { RHETORIC } from './forensics/rhetoric'
import { ZIPF_DRIFT } from './forensics/zipf'

import { EMBED } from './semantics/embed'
import { TOPIC_REL } from './semantics/topicRel'
import { STANCE } from './semantics/stance'
import { CONTRA_CHK } from './semantics/contradiction'

import { NATAL_CHART } from './esoteric/natal'
import { GEMATRIA } from './esoteric/gematria'
import { PRIME_SIG } from './esoteric/prime'
import { PHONETIC } from './esoteric/phonetic'
import { ENTROPY } from './esoteric/entropy'
import { COMPRESS } from './esoteric/compress'

import { CORROBORATE } from './field/corroborate'
import { PRIOR_ART } from './field/priorArt'

export const ALL_OPERATORS = [
  TOKENIZE,
  HEDGE_7,
  VALENCE_ARC,
  FK_READ,
  PARSE_DEPTH,
  CLAIM_EX,
  MODALITY,
  RHETORIC,
  ZIPF_DRIFT,
  EMBED,
  TOPIC_REL,
  STANCE,
  CONTRA_CHK,
  NATAL_CHART,
  GEMATRIA,
  PRIME_SIG,
  PHONETIC,
  ENTROPY,
  COMPRESS,
  CORROBORATE,
  PRIOR_ART,
]

export {
  TOKENIZE,
  HEDGE_7,
  VALENCE_ARC,
  FK_READ,
  PARSE_DEPTH,
  CLAIM_EX,
  MODALITY,
  RHETORIC,
  ZIPF_DRIFT,
  EMBED,
  TOPIC_REL,
  STANCE,
  CONTRA_CHK,
  NATAL_CHART,
  GEMATRIA,
  PRIME_SIG,
  PHONETIC,
  ENTROPY,
  COMPRESS,
  CORROBORATE,
  PRIOR_ART,
}

export * from './registry'
