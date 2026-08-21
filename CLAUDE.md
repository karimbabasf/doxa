# DOXA

An opinion goes in. A planner agent composes a bespoke analysis pipeline for that exact text,
a human signs it, the DAG runs under tracing, and a unique dithered specimen comes out with a
certificate of every operation performed.

Read `docs/superpowers/plans/2026-08-19-doxa.md` before writing code. Every type is fixed in
`lib/types.ts`.

## Hard rules

- All model calls go through ONE provider, read as a pair from `LLM_BASE_URL` +
  `LLM_API_KEY` by `lib/env.ts`, which throws if only one is set. Never read `OPENAI_API_KEY`,
  `OPENAI_BASE_URL` or `ANTHROPIC_API_KEY`: the shell has a stray `OPENAI_API_KEY` and reading it
  would silently authenticate against a provider nobody chose. That guard is the point, and it holds
  whatever the pair points at.
- **The pair points at OpenAI.** Karim's call, 2026-08-20, because he had an OpenAI key to hand.
  Nothing in the client changed, since NEAR AI Cloud and OpenAI are both OpenAI-compatible. The
  variables were named `NEAR_AI_*` until 2026-08-20 and are now `LLM_*`, which stays true whichever
  provider the pair points at. Models in use: `gpt-5.2` for chat, `text-embedding-3-small` for
  embeddings, and those are the defaults in `lib/llm.ts`.
- No em dashes or en dashes anywhere: code, comments, docs, commits, UI copy.
- `lib/operators/`, `lib/executor/`, `lib/foundry/` import nothing from `next/*` or `react`.
- Two remotes. `origin` is `karimbabasf/doxa`, public, branch `main`. `shared` is the team hackathon
  repo `mfinikov/zero-hackathon`, where Karim's work lives on the branch `karimbabasf/doxa` and
  **`main` is never a push target**. A push refspec on `shared` enforces that. Push only when Karim
  asks in the moment.

## Bright Data collectors

Reuse these. Do not build a new scraper for a target already listed here.

| Purpose | Collector ID | Target | Status |
|---|---|---|---|
| PRIOR-ART | `c_mt12spi4173gff7wai` | `https://en.wikiquote.org/wiki/<Topic>` | built. Data good, but `attributed_to` is mis-bound and the heal does not reach production. |
| CORROBORATE | `c_mt12stqk2d78cqkmn2` | `https://tildes.net/~<group>` | built and verified, 250 clean rows |
| DEMO-SHOP | not built yet | our own `/demo/shop/[set]` page over a tunnel | build Friday 08-21, after the tunnel URL check in Task 17 Step 2. Pin the ID here. |

### DEMO-SHOP page contract

The page is built and committed. Build Friday's collector against exactly these selectors, and put
the same field names in the `bdata scraper create` description.

| Field | Selector | Notes |
|---|---|---|
| `name` | `.product .name` | |
| `price` | `.product .price` | **This is the one that breaks.** The break button renames it to `.cost`. Nothing else changes: same text, same layout, same 200. |
| `sku` | `.product .sku` | |
| `stock` | `.product .stock` | |

Set slugs are `a`, `b` and `c` at `/demo/shop/a`, `/demo/shop/b`, `/demo/shop/c`, each holding
different products. They exist so `fetchWithRepair` always has an untouched URL for its verify
scrape: scrape `a`, verify on `b`. `mustVary` is `name`, `sku`.

The break is a renamed selector on purpose. Healers fix those. They do not fix mis-bound fields,
which is the entire explanation of the PRIOR-ART failure above.

## The heal is never believed on its own word

`bdata scraper heal` reported success on the PRIOR-ART collector on 2026-08-20, showed a correct
preview, and production kept serving the same wrong author on all 149 rows. So:

- `repaired: 'yes'` means re-scraped and re-validated, never "the healer said so".
- `fetchWithRepair` takes a **required** `verifyInput`: a second input the run has not scraped. After
  a heal it re-scrapes the original input for the data, then scrapes `verifyInput` for the proof.
  Both must pass the gate. One re-scrape of the same input cannot tell a real fix from a cache.
- Healers fix renamed selectors. They do not fix mis-bound fields. The on-camera break is always a
  renamed class, never a re-bound element.

### PRIOR-ART real output shape

The scraper returns ONE row per page, with the quotations nested. It does not return one row per
quotation, whatever the build description asked for. Code must flatten before validating.

```
[ { input: { url }, product_page_url: string,
    quotations: [ { quote_text, attributed_to, source_note, section_heading } ] } ]
```

Verified 2026-08-20: 149 quotations from the Technology page, `quote_text` / `attributed_to` /
`section_heading` 149/149 filled, `source_note` 140/149.

**These are the only field names that exist. Never invent one.** A plan that tests a field the
scraper does not return produces a schema failure that no amount of healing can fix, because the
scraper is doing what it was asked and the check is wrong.

## Why the schema gate checks three things, not one

Found by running the real scraper on 2026-08-20. `attributed_to` came back non-empty on all 149
rows and was the identical wrong name ("Isaac Asimov") on every one, because the field bound to a
page-level element instead of each quote's own citation. A presence check passes that. An
emptiness check passes that too.

So `checkRows` gates on three conditions:
1. every declared field is present,
2. the field is not empty on every row,
3. the field does not hold one identical value across every row when there is more than one row.

Condition 3 is the one that catches a mis-bound selector, and it is the reason the repair loop
gets a useful failure message instead of shipping 149 rows of confidently wrong data.

### CORROBORATE real output shape

Different shape from PRIOR-ART. This one is flat: one row per topic, no nesting. Code must handle
both shapes rather than assuming a single convention across collectors.

```
[ { title, topic_url, group, posted_at, comment_count, product_page_url, input: { url } } ]
```

Verified 2026-08-20 on `https://tildes.net/~tech`: 250 rows, all seven fields 100% filled,
250 distinct titles and urls, 104 distinct `posted_at`, 57 distinct `comment_count`.

### mustVary, and why the identical-value gate is opt-in per field

That same run had `group` = "tech" on all 250 rows, correctly, because we scraped one group. A blanket
identical-value check would fail a perfect scrape. So condition 3 applies only to fields passed in
`mustVary`, meaning fields whose entire purpose is to differ per row:

| Collector | mustVary |
|---|---|
| PRIOR-ART | `quote_text`, `attributed_to` |
| CORROBORATE | `title`, `topic_url` |

## Measured timings, 2026-08-20

First live run of the whole pipeline. These replace the estimates the plan was written with.

| Thing | Measured | Note |
|---|---|---|
| One real scrape | ~115s | The free tier prints "Realtime page limit exceeded, switching to batch mode" and falls back to batch polling. This is the single biggest cost in the app. |
| `CORROBORATE` end to end | 89.5s | 24 sources checked, `repaired: no`. |
| Full run, one field operator | ~90s | 29,225 real operations. |
| Full run, no field operator | ~2 to 4s | Everything else is arithmetic over a sentence. |
| Planner call, `gpt-5.2` | ~8s | |

Consequences already in the code:
- `estMs` on both field operators is `120_000`, not the `9000` the plan guessed.
- The executor's timeout is per operator, `timeoutFor(op, globalMs)` in `lib/executor/run.ts`, because
  a flat 45s ceiling cut `CORROBORATE` on its first live run while forensics finished in milliseconds.
- `BRIGHTDATA_CLI` defaults to `./node_modules/.bin/bdata`, not `npx -p @brightdata/cli`, which
  re-resolved the package on every call.

The repair path is a heal plus two scrapes, so budget four to six minutes, not 90 seconds. See Task 17.
