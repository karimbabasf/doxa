# DOXA: an industrial refinery for opinions

Design spec. Written 2026-08-19. Target: Zero Downtime Hackathon (2026-08-22, in person,
Anthropic judging) and Into the Scrape-Verse (online, closes 2026-08-23). One build, both entries.

## 1. What it is

One sentence of opinion goes in. A planner agent reads it and writes a bespoke analysis pipeline
for that specific opinion. A human approves the plan. The pipeline executes as a traced factory
line of real computation: linguistic forensics, semantic analysis, and an esoteric wing that
treats every word as if it has a birth chart. It ends by striking a unique dithered specimen from
the collected readings, plus a certificate showing every operation performed.

## 2. What wins

The pipeline is composed, not hardcoded. Two people type two opinions and get two visibly
different factory lines, because the planner picks and orders operators to suit the text in front
of it. The live demo is a judge typing their own opinion, watching a machine write a plan for it,
approving that plan, and watching it run under real traces.

Judging criteria this targets:
- Use of Bright Data: the field-work stage is the only source of outside evidence, and the
  self-heal runs on camera.
- Reliability and self-healing: bounded repair loop, schema gate, then a human, never a silent pass.
- Technical excellence: composed DAG, real concurrency, full attribution from reading to pixel.
- Creativity: the esoteric wing, played straight.
- Presentation: the certificate is a finished artifact, not a screenshot of a terminal.
- Best UI (Suit-Up track): the work order gate and the live floor are the two screens that earn it.

## 3. Architecture

Eight stages. Each is a separate module with one job.

```
INTAKE -> PLANNER -> GATE -> FLOOR -> FIELD WORK -> RECONCILIATION -> FOUNDRY -> CERTIFICATE
                      ^                    |
                      |                    v
                    human              Bright Data
```

| Stage | Module | Job |
|---|---|---|
| INTAKE | `lib/intake` | Accept raw text, assign a batch ID, normalise whitespace and quotes, reject input under 3 words or over 500 characters. |
| PLANNER | `lib/planner` | One structured LLM call. Reads the opinion, picks operators, orders them, writes a rationale per pick, estimates cost and runtime. Emits a Work Order. |
| GATE | `app/(gate)` | Renders the Work Order as a DAG. Operator toggles. Human signs. Signature stored on the batch. |
| FLOOR | `lib/executor` | Topological execution of the approved DAG with a concurrency pool. Streams progress. One SigNoz span per operator. |
| FIELD WORK | `lib/field` | Bright Data operators. Corroboration sweep and prior art. Schema gate plus bounded repair. |
| RECONCILIATION | `lib/reconcile` | One LLM call reads every reading, sober and esoteric alike, and writes one dry paragraph of plain English. |
| FOUNDRY | `lib/foundry` | Collapses all readings into one parameter vector and renders the specimen. Zero deps, deterministic. |
| CERTIFICATE | `app/(certificate)` | One page holding opinion, plan, every stage, evidence, verdict and specimen. Shareable, printable. |

## 4. The operator contract

This is the load-bearing abstraction. Everything else is plumbing around it.

```ts
type Wing = 'forensics' | 'semantics' | 'esoteric' | 'field'

type Operator = {
  id: string              // 'HEDGE-7'
  name: string            // 'Hedge and booster lexicon'
  wing: Wing
  blurb: string           // one line, shown in the work order
  needs: string[]         // operator ids whose output this consumes
  costUnits: number       // arbitrary units, summed for the work order estimate
  estMs: number
  touches: string[]       // render param paths this operator can write
  run(ctx: Ctx): Promise<OperatorResult>
}

type OperatorResult = {
  id: string
  ops: number                              // real operation count, feeds the live counter
  readings: Record<string, number | string>
  evidence?: Evidence[]                    // snippets with source url and retrieved-at
  render?: Partial<RenderParams>           // this operator's contribution to the specimen
  notes?: string[]
}
```

Two consequences fall out for free:
- `needs` gives the executor its DAG. No separate graph definition.
- `touches` plus `render` gives the specimen full attribution. Hovering a visual property in the
  foundry names the operator that set it, with no extra bookkeeping.

Every operator is a pure function of `Ctx` except the field-work ones, which are the only network
calls in the library. That keeps the whole forensics and esoteric layer testable without fixtures.

## 5. The operator library

All of these return real numbers from real computation. Nothing is faked or stubbed.

### Forensics wing
| ID | Returns | Touches |
|---|---|---|
| `TOKENIZE` | tokens, sentences, POS tags | (none, feeds others) |
| `HEDGE-7` | hedge score, booster score, net conviction | `dither.matrix` |
| `VALENCE-ARC` | valence per clause, arc shape, net polarity | `field.type` |
| `FK-READ` | Flesch-Kincaid grade, Gunning fog | `field.scale` |
| `PARSE-DEPTH` | syntactic tree height, clause count | `field.octaves` |
| `CLAIM-EX` | the assertion, stripped of hedging | (feeds field work) |
| `MODALITY` | must / should / could / may distribution | `frame.fill`, `dither.bias` |
| `RHETORIC` | analogy, hyperbole, appeal to authority, false dilemma | `primitives.arrangement` |
| `ZIPF-DRIFT` | lexical rarity against a frequency corpus | `primitives.sizeBias` |

### Semantics wing
| ID | Returns | Touches |
|---|---|---|
| `EMBED` | the embedding vector | (feeds others, and the future graph) |
| `TOPIC-REL` | cosine against a fixed topic taxonomy, ranked | `palette.ink`, `dither.levels` |
| `STANCE` | stance toward the extracted claim, with confidence | `frame.bleed` |
| `CONTRA-CHK` | per-clause embeddings, internal opposition score | `field.warpAmp` |

### Esoteric wing
Played entirely straight. Deterministic, documented, and wired into the render so it is structural
rather than decorative.

| ID | Returns | Touches |
|---|---|---|
| `NATAL-CHART` | a sign per word from its character codes, then the sentence's element balance (fire, earth, air, water) and dominant modality (cardinal, fixed, mutable) | `palette.ground`, `primitives.arrangement` |
| `GEMATRIA` | letter sum and digital root | `primitives.count` |
| `PRIME-SIG` | prime factorisation of the character-code product | `seed` |
| `PHONETIC` | plosive density, consonant to vowel ratio, Metaphone clusters | `dither.contrast` |
| `ENTROPY` | Shannon entropy of the character distribution | `field.warpFreq` |
| `COMPRESS` | gzip ratio of the raw string | `field.octaves` |

### Field wing (Bright Data)
| ID | Returns | Touches |
|---|---|---|
| `CORROBORATE` | corroboration score plus cited snippets for or against the extracted claim | `palette.ground` |
| `PRIOR-ART` | closest prior public statement of the same take, with date and source, plus an originality score | `primitives.count` |

The planner picks between these: `CORROBORATE` when `CLAIM-EX` yields a checkable factual claim,
`PRIOR-ART` when the opinion is taste or judgement rather than fact. Both when it is either.

## 6. The work order

The planner's output. This is what the human signs.

```ts
type WorkOrder = {
  batchId: string
  opinion: string
  operators: { id: string; rationale: string; enabled: boolean }[]
  estCostUnits: number
  estMs: number
  estOps: number
  plannerNotes: string     // why this shape of pipeline, in one paragraph
  createdAt: string
}
```

The gate screen renders the DAG from `needs`, shows each rationale, and lets the human switch
operators off. Switching off an operator that others depend on disables its dependents too, and
the UI says so rather than failing at run time. Signing stamps the work order row with a signature
time and unlocks the floor. The signed order is the plan of record and it lives in this app.

## 7. Execution

Topological sort on `needs`, then a worker pool. Independent operators run concurrently, which is
what makes the live floor look like a factory rather than a queue.

Per operator, the executor:
1. opens a SigNoz span with the operator id, wing and inputs,
2. runs it under a timeout,
3. validates the result against the operator's declared shape,
4. records ops, duration, readings and render contribution,
5. streams a floor event to the client.

An operator that throws marks itself failed and its dependents skipped. The run continues. A
failed operator never silently contributes default render params, because a specimen built partly
from defaults is a lie about what was measured.

## 8. Self-healing, and the rule it satisfies

Bright Data's stated judging hook is `bdata scraper heal` working on camera. The field operators
run behind a schema gate:

1. Scrape returns rows.
2. Rows are validated against the schema the plan declared.
3. On failure, one repair attempt: `bdata scraper heal` with the exact validation error.
4. Re-scrape and re-validate.
5. Second failure stops and calls a human. It does not ship a third guess.

Two lessons carried over from the deleted `factory-demo` prototype, both real bugs found by
building it:
- The plan must be handed the scraper's real field names and may not invent its own, or the
  schema check tests a field that was never collected.
- The repair loop is bounded at two attempts, each told exactly why the last one failed. Unbounded
  repair writes lazy patterns that pass the gate while returning garbage.

For the demo we host one source page ourselves and rename its price element mid-run, so the break
happens on our schedule instead of the web's. A second scraper points at a real public long-tail
site so the whole thing is not a sandbox.

## 9. The foundry

All render contributions merge into one parameter vector:

```ts
type RenderParams = {
  field:      { type: 'bloom' | 'collapse' | 'lattice' | 'fracture'
                scale: number; warpAmp: number; warpFreq: number; octaves: number }
  primitives: { count: number; arrangement: 'radial' | 'grid' | 'spiral' | 'scatter'
                sizeBias: number }
  dither:     { matrix: 2 | 4 | 8; levels: number; contrast: number; bias: number }
  palette:    { ink: string; ground: string }
  frame:      { fill: number; bleed: boolean }
  seed: number
}
```

The renderer builds a greyscale field from signed distance primitives plus domain warp, then
quantises it through the chosen dither matrix. Dependency free, deterministic given
`(params, seed)`, and fast enough to re-render on a slider drag.

`seed` comes from `PRIME-SIG`, which derives from the exact input text. Two opinions that score
identically on every axis still produce different specimens, and the same text always produces the
same specimen.

### Contribution merge

Six params are deliberately claimed by more than one operator, so a specimen is an argument between
wings rather than a lookup table. Contributions are `(value, weight)` pairs, and the foundry merges
them by one rule:

- Numeric params blend as a weighted mean.
- Categorical params (`field.type`, `primitives.arrangement`, `palette.*`) take the highest weight,
  ties broken by wing order.
- Wing weights: field 1.0, forensics 0.8, semantics 0.7, esoteric 0.5. An operator may scale its own
  weight by its confidence, so a stance detector that is unsure contributes less than one that is not.
- Attribution stores every contributor with its weight, and names the dominant one. A blended param
  reports as blended rather than crediting a single assay it did not solely produce.

A param with no contributions is a bug, not a default. The foundry throws if one is unset, because a
specimen part-built from defaults misrepresents what was measured.

Attribution comes from `touches`: the foundry records which operator wrote each param, so the UI
can name the assay behind any visual property.

## 10. The certificate

One page, shareable and printable: the opinion, the signed work order, every operator with its
inputs, outputs, duration, op count and SigNoz trace ID, the field evidence with sources and
retrieval times, the reconciliation paragraph, and the specimen. This is the artifact for the demo
video and the LinkedIn post (Daily Bugle track).

## 11. Sponsor integration

| Sponsor | Role | Load-bearing because |
|---|---|---|
| Bright Data | Field work: corroboration and prior art. Scraper Studio via the CLI, collector IDs pinned in `CLAUDE.md`. | It is the only source of outside evidence. No scraper, no verdict on whether the opinion holds up. |
| SigNoz | One span per operator, one trace per batch. Latency, failure and repair events. | The floor screen and the certificate both read from it. |

**Port is deliberately not used.** Karim cut it on 2026-08-19. The consequence is recorded here so it
does not get re-argued: Zero Downtime's grand prize is scored on "Best Full-Stack Integration" of
Port, Bright Data and SigNoz, so that prize is out of reach. The two track prizes it does compete for
(Best Bright Data Scraper Studio Integration, Best SigNoz Integration) are unaffected, and
Scrape-Verse never mentions Port at all, so its whole prize pool is unaffected. Everything Port would
have held (the signed work order, the operator catalogue, batch health) is already in this app's own
database and screens, so nothing structural depends on it.

## 12. Stack

- Next.js (App Router) + TypeScript + Tailwind, at `~/Developer/Apps/doxa`. Local git, no remote.
- LLM calls go through NEAR AI Cloud (OpenAI-compatible). The base URL and key are read as a pair
  from `.env.local`, and the app refuses to start if only one is present, so a stray shell
  `OPENAI_API_KEY` can never silently authenticate against the wrong provider.
- The operator library, executor and renderer are plain TypeScript with no framework imports, so
  they are unit-testable and survive whatever gets bolted on later.
- Storage: SQLite (local file) holding batches, work orders, operator results and specimens. Each
  batch stores the raw opinion and its embedding, which is the seam the similarity graph plugs into
  later without a rewrite.

## 13. Testing

- Every forensics and esoteric operator: unit tests on known inputs with known outputs. These are
  pure functions, so no fixtures and no network.
- Executor: DAG ordering, concurrency, failure isolation, dependent skipping.
- Renderer: golden hash of the pixel buffer for a fixed `(params, seed)`.
- Planner: fixture-based, asserting a valid work order shape and that dependencies resolve.
- Field operators: recorded fixtures for the happy path, plus a break-and-heal integration test.

## 14. Risks

| Risk | Handling |
|---|---|
| Bright Data scraper creation takes 5 to 25 minutes per target | Starts first, before any UI work. |
| Two sponsor accounts do not exist yet (Bright Data plus its promo code, SigNoz) | Karim's task, in parallel with the build. Blocks integration, not the engine. |
| The planner writes an invalid or circular DAG | Validate and topologically sort before the gate renders. Reject and retry once, then fall back to a full-library order. |
| The UI is the second long pole | It is also the Suit-Up prize, so it gets the hours it needs. Gate and floor first, certificate last. |
| Live demo depends on network | The specimen path and every forensics and esoteric operator run offline. Only field work needs the network, and a cached batch is kept as the fallback. |

## 15. Out of scope

The similarity graph, vector search across opinions, and scraped opinion intake. The embedding is
computed and stored now so these drop in later, but nothing is built for them in this pass.
