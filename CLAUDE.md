# DOXA

An opinion goes in. A planner agent composes a bespoke analysis pipeline for that exact text,
a human signs it, the DAG runs under tracing, and a unique dithered specimen comes out with a
certificate of every operation performed.

Read `docs/superpowers/plans/2026-08-19-doxa.md` before writing code. Every type is fixed in
`lib/types.ts`.

## Hard rules

- All model calls go through NEAR AI Cloud. Env is `NEAR_AI_BASE_URL` + `NEAR_AI_API_KEY`, read
  as a pair by `lib/env.ts`. Never read `OPENAI_API_KEY`, `OPENAI_BASE_URL` or `ANTHROPIC_API_KEY`.
- No em dashes or en dashes anywhere: code, comments, docs, commits, UI copy.
- `lib/operators/`, `lib/executor/`, `lib/foundry/` import nothing from `next/*` or `react`.
- Local git only. No remote, no push, unless Karim asks in the moment.

## Bright Data collectors

Reuse these. Do not build a new scraper for a target already listed here.

| Purpose | Collector ID | Target | Status |
|---|---|---|---|
| PRIOR-ART | `c_mt12spi4173gff7wai` | `https://en.wikiquote.org/wiki/<Topic>` | built. Data good, but `attributed_to` is mis-bound and the heal does not reach production. |
| CORROBORATE | `c_mt12stqk2d78cqkmn2` | `https://tildes.net/~<group>` | built and verified, 250 clean rows |

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
