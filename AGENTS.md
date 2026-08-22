# AGENTS.md

The brief for any agent working on DOXA. Read this before the first edit.

## What DOXA is

One sentence of opinion goes in. A planner agent reads that exact text and writes a bespoke
analysis pipeline for it. A human signs the plan at a gate. The pipeline then runs as a traced
DAG of real computation, and it ends by striking a unique 1-bit dithered specimen plus a
certificate listing every operation performed.

The pipeline is composed, not hardcoded. Two people type two opinions and get two visibly
different factory lines, because the planner picks and orders operators to suit the text.

## Read before you write code

| File | Why |
|---|---|
| `CLAUDE.md` | Live operational knowledge: Bright Data collector ids, the real output shape of every scraper, measured timings, and the reasons behind the schema gate. Facts here were verified against live runs. Trust it over your own guess. |
| `lib/types.ts` | Every type in the app is fixed here. Do not invent a parallel shape. |
| `docs/superpowers/plans/2026-08-19-doxa.md` | The build plan, task by task. |
| `docs/superpowers/specs/2026-08-19-doxa-design.md` | The design record. |

## Run and verify

```bash
pnpm install
cp .env.local.example .env.local   # then fill LLM_BASE_URL and LLM_API_KEY
pnpm dev                           # http://localhost:3000
pnpm test                          # 544 tests, all must pass
npx tsc --noEmit                   # must report no errors
pnpm lint                          # 6 errors and 4 warnings today, all pre-existing
```

`pnpm test` and `npx tsc --noEmit` are the gate. Never report work as done without running both
and pasting what they printed. The lint errors are React hook and Next image rules in five
components that predate this file. Do not fold a lint sweep into an unrelated change.

The app runs without a Bright Data session, without SigNoz, and without the demo shop. Only the
LLM pair is required.

## Hard rules

1. **One model provider, read as a pair.** `lib/env.ts` reads `LLM_BASE_URL` and `LLM_API_KEY`
   together and throws if only one is set. Never read `OPENAI_API_KEY`, `OPENAI_BASE_URL` or
   `ANTHROPIC_API_KEY`. The shell on this machine has a stray `OPENAI_API_KEY`, so reading it
   would silently authenticate against a provider nobody chose. That guard is the point.
2. **No em dashes or en dashes anywhere.** Code, comments, docs, commit messages, UI copy.
   Use commas, colons or parentheses. The one exception is the Next.js block at the bottom of
   this file, which `next dev` writes and re-adds on every run.
3. **`lib/operators/`, `lib/executor/` and `lib/foundry/` import nothing from `next/*` or
   `react`.** They are plain TypeScript so they stay unit testable and so the client bundle never
   drags the operator library into the browser.
4. **One DAG walker.** `layer()` in `lib/executor/topo.ts` is the only topological sort. The
   planner, the gate screen and the dive all call it. A second walker would eventually disagree
   with the first, and the one on screen would be the one lying.
5. **The heal is never believed on its own word.** `bdata scraper heal` reported success on a
   collector that kept serving wrong data. `repaired: 'yes'` means re-scraped and re-validated
   against a second input the run has not touched. See `CLAUDE.md` for the full account.
6. **Never invent a scraper field name.** Use only the names listed in `CLAUDE.md`. A check
   against a field the collector does not return produces a schema failure no heal can fix.

## The map

```
app/page.tsx              front door: the opinion box and the rolling column of samples
app/api/plan/             the planner call, then the signature
app/(gate)/gate/          the human gate: four steps in plain words, then sign
app/api/run/              executes the signed DAG under tracing
app/(floor)/floor/        the live factory line while the run happens
app/(certificate)/        the certificate: every operation, plus the struck specimen
app/graph/                the similarity graph across all batches, with a dive panel
app/demo/shop/[set]/      the break-and-heal demo target, three product sets

lib/types.ts              every shared type
lib/env.ts                the paired credential guard
lib/llm.ts                the only chat and embedding client
lib/db.ts                 sqlite schema and accessors
lib/planner/plan.ts       composes a work order for one opinion
lib/planner/validate.ts   refuses an order the factory cannot run, before a human signs it
lib/executor/topo.ts      layer(), the one topological sort
lib/executor/run.ts       runs the layers, per operator timeouts, writes results
lib/operators/            21 operators in four wings, plus DEMO-SHOP behind a flag
lib/foundry/              render parameters to a 1-bit dithered PNG, zero dependencies
lib/graph/                layout, camera and similarity for the graph screen
lib/tracing.ts            OpenTelemetry to SigNoz, optional
```

**Operator wings:** forensics 9, semantics 4, esoteric 6, field 2. `DEMO-SHOP` is a third field
operator that registers itself only under `DOXA_DEMO_SHOP=1`, so it is not in `ALL_OPERATORS`.

**Registration is a side effect of import.** Each operator file calls `register()` for itself.
Importing `lib/operators/index.ts` is what fills the registry. Any entry point that plans or runs
a batch must import it once, or `allOperators()` comes back empty and the planner composes a
pipeline out of nothing. `lib/planner` deliberately does not import it, so the planner can be
unit tested against a fixture set.

## Traps that have already bitten

- **A field operator costs about two minutes, not nine seconds.** The free Bright Data tier prints
  "Realtime page limit exceeded, switching to batch mode" and falls back to polling. `estMs` on
  both web field operators is `120_000` and the executor's timeout is per operator, not global.
  A flat ceiling cut a live run.
- **A repair path is a heal plus two scrapes.** Budget four to six minutes. `DEMO-SHOP` is the
  exception: it asks for `RepairOpts.sync`, which fits its six rows inside the CLI's synchronous
  cap and finishes in about a minute. The two web collectors must never ask for sync, because a
  250 row scrape overruns the cap and returns nothing rather than late rows.
- **The planner is a language model, so it can name an operator that does not exist.** The gate
  screen and the dive route both wrap `getOperator` in a try/catch on purpose. That guards a live
  failure, it is not leftover compatibility code. Do not remove it.
- **The foundry refuses to default a parameter nobody measured.** A plan that touches too few
  render paths makes the merge throw and the run ends with no image. `lib/planner/coverage.test.ts`
  pins the fix. Coverage additions exist for this reason.
- **Collector output shapes differ per collector.** PRIOR-ART and DEMO-SHOP nest their rows.
  CORROBORATE is flat. Code must handle both rather than assume one convention.

## Torn out on 2026-08-22, being rebuilt

The graph and the specimen are commented out, not deleted. Karim's call: both are being
rebuilt from scratch, and the run that ends after step 3 is the state the build is happy with.
Grep `TORN OUT 2026-08-22` for every seam. What that covers:

- `app/api/run/route.ts` no longer merges contributions or writes a specimen row, and the
  `complete` event carries no `params` or `attribution`.
- `lib/planLanguage.ts` drops the print step, so the gate and the floor sign for three steps.
- The floor no longer ends on the graph, and `/graph`, `/api/graph` and `/api/dive` are stubs.
- Certificate section 06 is commented out. The receipt, sections 01 to 05, is untouched.

`lib/foundry/`, `lib/graph/`, `components/graph/` and `components/Specimen.tsx` are left whole
and unreferenced, with their tests still running. The planner still adds coverage operators for
render paths nothing reads yet, which is deliberate: cutting that would change which operators
run, and the run is the part that works.

## Deliberately unfinished, do not delete

- **The reconciliation stage.** `batches.verdict` exists in the schema, `setBatchVerdict` in
  `lib/db.ts` is its writer, and section 05 of the certificate reads it. No stage calls the writer
  yet, so that section renders its empty state on every batch today. The seam is intentional.
- **`/api/demo/break`.** GET reports the flag, POST breaks the demo shop page by renaming its
  price class, DELETE restores it. It has no button on any screen, so drive it with curl:
  `curl -X POST localhost:3000/api/demo/break`. The break is a renamed selector on purpose,
  because healers fix those and do not fix mis-bound fields.
- **Three copies of the database path helper**, in `app/api/plan/db.ts`, `lib/demo/state.ts` and
  the certificate page. All three read `DOXA_DB_PATH` and default to `data/doxa.db`. They are one
  line each and unifying them would push an import across the app and lib boundary. Leave them,
  but keep all three in step.

## Git

Two remotes, and they are not interchangeable.

| Remote | Repo | Karim's branch |
|---|---|---|
| `origin` | `karimbabasf/doxa`, public | `main` |
| `shared` | `mfinikov/zero-hackathon`, the team hackathon repo | `karimbabasf/doxa` |

- **`main` on `shared` is never a push target.** A push refspec enforces it. The default branch
  there, `mfinikov/aidline-disaster-aid-map`, holds a different project with an unrelated history,
  so GitHub cannot compare or merge the two.
- **Push only when Karim asks in the moment.** Creating a remote or a repository needs the same
  explicit say so. Commit freely.
- Commit messages match the repo style: lower case type prefix where the change has one
  (`feat:`, `fix:`, `docs:`, `refactor:`), or a plain sentence in the present tense. No AI
  attribution, no generated-with footers.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
