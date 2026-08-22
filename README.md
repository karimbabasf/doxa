# DOXA

An industrial refinery for opinions.

One sentence of opinion goes in. A planner agent reads it and writes a bespoke analysis pipeline for
that specific text. A human approves the plan. The pipeline runs as a traced factory line of real
computation: linguistic forensics, semantic analysis, and an esoteric wing that treats every word as
if it has a birth chart. It ends by striking a unique dithered specimen from the collected readings,
plus a certificate showing every operation performed.

The pipeline is composed, not hardcoded. Two people type two opinions and get two visibly different
factory lines, because the planner picks and orders operators to suit the text in front of it.

## Where this lives

This build is the branch `karimbabasf/doxa` in the shared repo `mfinikov/zero-hackathon`. The repo's
default branch, `mfinikov/aidline-disaster-aid-map`, holds the earlier Discourse prototype. The two
branches have unrelated histories, so GitHub cannot compare or merge them. Read them as two separate
projects that share one repo.

The same history is public at `github.com/karimbabasf/doxa`, because Scrape-Verse requires a public
repo. Both remotes carry the same commits.

## How to run it

Requires Node 20 or newer and pnpm.

```bash
pnpm install
cp .env.local.example .env.local   # then fill in the values below
pnpm dev                           # http://localhost:3000
```

Environment, all in `.env.local`:

| Variable | Needed for | Notes |
|---|---|---|
| `LLM_BASE_URL` | every model call | `https://api.openai.com/v1`. Any OpenAI-compatible provider works. |
| `LLM_API_KEY` | every model call | Read as a pair with the base URL. The app refuses to start with only one of them. **This is the only variable you must set.** |
| `LLM_MODEL` | the planner, CLAIM-EX, STANCE, reconciliation | Defaults to `gpt-5.2`. |
| `LLM_EMBED_MODEL` | EMBED, TOPIC-REL, CONTRA-CHK | Defaults to `text-embedding-3-small`. |
| `BRIGHTDATA_PRIOR_ART_ID`, `BRIGHTDATA_CORROBORATE_ID` | the field wing | Optional. Both default to our collectors. The CLI holds the credentials, so run `bdata login` once instead of setting a token here. |
| `SIGNOZ_ENDPOINT`, `SIGNOZ_INGESTION_KEY` | tracing | Optional. Tracing degrades to a no-op when absent; it never blocks a run. |

Nothing in this codebase reads `OPENAI_API_KEY`, `OPENAI_BASE_URL` or `ANTHROPIC_API_KEY`. That is
deliberate and tested: a stray key in the shell must never silently authenticate against the wrong
provider.

One step after adding the key, once:

```bash
pnpm dlx tsx scripts/build-topic-anchors.ts   # fills the 16 topic anchor vectors in data/topics.json
```

`data/topics.json` ships with the topics and their colours but no vectors. TOPIC-REL throws and names
that script rather than scoring against zeros, because a confident wrong topic is worse than an error.

## How to test it

```bash
pnpm test          # vitest, 522 tests across 49 files
npx tsc --noEmit   # clean
pnpm build         # 13 routes
```

Every forensics and esoteric operator is a pure function, so its tests assert exact values on known
inputs with no fixtures and no network. The LLM and Bright Data paths are mocked at the HTTP layer.

## Architecture

Eight stages, each a separate module with one job.

```
INTAKE -> PLANNER -> GATE -> FLOOR -> FIELD WORK -> RECONCILIATION -> FOUNDRY -> CERTIFICATE
                      ^                    |
                      |                    v
                    human              Bright Data
```

| Stage | Module | Job |
|---|---|---|
| INTAKE | `app/page.tsx`, `app/api/plan` | Accept raw text, assign a batch id, normalise whitespace and quotes, reject under 3 words or over 500 characters. |
| PLANNER | `lib/planner` | One structured model call. Picks operators, orders them, writes a rationale per pick, estimates cost and runtime. Emits a work order. |
| GATE | `app/(gate)` | Renders the work order as a DAG. Operator toggles. Human signs. |
| FLOOR | `lib/executor` | Topological execution with a concurrency pool. Streams progress. One span per operator. |
| FIELD WORK | `lib/operators/field` | Bright Data. Corroboration and prior art, behind a schema gate and a bounded repair loop. |
| FOUNDRY | `lib/foundry` | Collapses every reading into one parameter vector and renders the specimen. Zero dependencies, deterministic. |
| CERTIFICATE | `app/(certificate)` | One page holding opinion, plan, every stage, evidence and specimen. Printable. |

### The operator contract

The load-bearing abstraction. Everything else is plumbing around it.

```ts
type Operator = {
  id: string
  wing: 'forensics' | 'semantics' | 'esoteric' | 'field'
  needs: string[]        // operator ids whose output this consumes
  touches: RenderPath[]  // render params this operator may write
  run(ctx: Ctx): Promise<OperatorResult>
}
```

Two things fall out for free. `needs` gives the executor its DAG, so there is no separate graph
definition to drift out of sync. `touches` gives the specimen full attribution, so the certificate can
name the assay behind any visual property with no extra bookkeeping.

Twenty one operators: forensics 9, semantics 4, esoteric 6, field 2. All of them return real numbers
from real computation. `lib/operators/registration.test.ts` asserts that every render parameter has at
least one contributor, because a parameter with no contribution is a bug rather than a default: the
foundry throws instead of rendering a specimen part-built from defaults, which would misstate what
was measured.

## Bright Data, and how Scraper Studio was used

Two collectors, both built with `bdata scraper create` against long-tail public pages rather than
anything in the pre-built library.

| Purpose | Collector | Target |
|---|---|---|
| PRIOR-ART | `c_mt12spi4173gff7wai` | `en.wikiquote.org/wiki/<Topic>` |
| CORROBORATE | `c_mt12stqk2d78cqkmn2` | `tildes.net/~<group>` |

Targets were checked against `robots.txt` and real HTML before any build. MetaFilter, Lobsters and
Bearblog were all rejected on that check, which cost 40 seconds and saved building a scraper we could
not defend.

Example structured output, CORROBORATE, verified on `tildes.net/~tech`: 250 rows, all seven fields
filled, 250 distinct titles and urls.

```json
{
  "title": "The unreasonable effectiveness of plain text",
  "topic_url": "https://tildes.net/~tech/1abc/the_unreasonable_effectiveness_of_plain_text",
  "group": "tech",
  "posted_at": "2026-08-14T09:12:00Z",
  "comment_count": "37",
  "product_page_url": "https://tildes.net/~tech",
  "input": { "url": "https://tildes.net/~tech" }
}
```

PRIOR-ART returns a different shape: one row per page with the quotations nested, so the code
flattens before validating. Two collectors, two conventions, and assuming one of them is how you ship
wrong data.

## Why the gate checks three things

This is the part worth reading.

On 2026-08-20 the Wikiquote collector returned `attributed_to` = "Isaac Asimov" on all 149 rows of the
Technology page. The field had bound to a page-level element instead of each quote's own citation.
We ran `bdata scraper heal` with a precise description. Its preview showed correct per-quote authors,
Edward Abbey and Douglas Adams, exactly right. `bdata scraper approve` returned `status: done`. We
re-ran the collector and got the identical wrong value on every row. Caching was ruled out by scraping
`/wiki/Art`, a page never touched before: 343 quotes, all 343 "Isaac Asimov".

Two things came out of that, and both are in the code.

**The schema gate checks three conditions, not one.** Every declared field present, not empty on every
row, and not one identical value across every row. A presence check passes a mis-bound selector. So
does an emptiness check. Only comparing values across rows catches it. Condition three is opt-in per
field via `mustVary`, because some fields are legitimately constant: that same run had `group` = "tech"
on all 250 rows, correctly, because we scraped one group, and a blanket check would fail a perfect
scrape.

**`repaired` means re-scraped and re-validated, never "the healer said so".** `fetchWithRepair` takes
a required `verifyInput`: an input the run has not scraped. After a heal it re-scrapes the original
input for the data, then scrapes `verifyInput` for the proof, and both must pass the gate before the
result reports `repaired: 'yes'`. One re-scrape of the same input cannot separate a real fix from a
cache. Making `verifyInput` optional would mean somebody omits it under time pressure, which is
exactly when the check matters.

The repair loop is bounded at two attempts, each told exactly why the last one failed, then it stops
and calls a human. It never ships a third guess.

### Two kinds of break, and only one is a healer's job

Renamed selector: the page changed a class name, the scraper matches nothing. The repair is "read the
new page, find the new name". `bdata scraper heal` does this well. It is what it is for.

Mis-bound field: the scraper reads the wrong element. Nothing missing, nothing empty, the values are
simply wrong. The repair is "you misunderstood the shape of this page". Healers do not do this.

We tried the hard kind first, which is the whole explanation of what happened above. So the on-camera
break is always a renamed class. `app/demo/shop/[set]` is a shop page we own, holding structured
product records across three sets with different products, so the verify scrape always has an
untouched URL to reach for. `POST /api/demo/break` renames `.price` to `.cost`, and `DELETE` puts it
back. The page still returns 200 and still looks correct to a human, which is how this fails in the
wild.

## Honest notes

- Written 2026-08-19 to 2026-08-20 for Into the Scrape-Verse and the Zero Downtime Hackathon.
- **Port is deliberately not used.** Zero Downtime's grand prize needs all three sponsors tied
  together, so that prize is out of reach. Everything Port would have held, the signed work order and
  the operator catalogue, lives in this app's own database and screens. The demo video shows the
  in-app work order gate where the brief asks for a Port dashboard. Better than faking it.
- The PRIOR-ART collector's `attributed_to` is still mis-bound in production. With `mustVary` set, that
  operator is expected to fail its gate and call a human until the collector is rebuilt. That is correct
  behaviour, not a bug worked around: it must never return 149 rows of the same wrong name with
  `repaired: 'yes'` on them.
- Built with AI assistance, which both rule sets require disclosing. The spec and the implementation
  plan were written first and are committed in `docs/superpowers/`; the code was then written against
  them task by task.

## Licence

MIT.
