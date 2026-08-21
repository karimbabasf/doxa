/**
 * Fills the `anchor` vector into every topic in data/topics.json.
 *
 * Run once, check the result in. Run time never pays for sixteen topic embeddings,
 * and the demo works with a cold cache.
 *
 *   pnpm dlx tsx scripts/build-topic-anchors.ts
 *
 * It embeds every anchor sentence in one batched call, averages the three vectors
 * belonging to each topic, and rewrites the file. Cosine normalises, so the average
 * is stored raw rather than unit scaled.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { embed } from '../lib/llm'

type Topic = {
  name: string
  ink: string
  anchorSentences: string[]
  anchor?: number[]
}

const ROOT = process.cwd()
const TOPICS_PATH = path.resolve(ROOT, 'data/topics.json')
/** Enough precision that cosine is unaffected, small enough that the file stays readable. */
const DECIMALS = 6

/**
 * tsx does not load .env.local, and this script is the one place outside Next.js
 * that needs the credential pair. Only LLM_ keys are copied across, so a stray
 * OPENAI_API_KEY sitting in the environment can never reach lib/llm.ts.
 */
function loadLlmEnv(): void {
  const envPath = path.resolve(ROOT, '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*(LLM_[A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) continue
    const key = match[1]
    const value = match[2].replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

async function main(): Promise<void> {
  if (!existsSync(TOPICS_PATH)) {
    throw new Error(`Cannot find ${TOPICS_PATH}. Run this from the repo root.`)
  }
  loadLlmEnv()

  const topics = JSON.parse(readFileSync(TOPICS_PATH, 'utf8')) as Topic[]
  const flat: string[] = []
  const spans: { start: number; count: number }[] = []
  for (const topic of topics) {
    if (!topic.anchorSentences?.length) {
      throw new Error(`Topic "${topic.name}" has no anchorSentences to embed.`)
    }
    spans.push({ start: flat.length, count: topic.anchorSentences.length })
    flat.push(...topic.anchorSentences)
  }

  console.log(`Embedding ${flat.length} anchor sentences across ${topics.length} topics.`)
  const vectors = await embed(flat)
  if (vectors.length !== flat.length) {
    throw new Error(`Expected ${flat.length} vectors, the provider returned ${vectors.length}.`)
  }

  const dims = vectors[0].length
  const anchors = spans.map(({ start, count }) => {
    const mean = new Array<number>(dims).fill(0)
    for (let i = start; i < start + count; i++) {
      const vec = vectors[i]
      if (vec.length !== dims) {
        throw new Error(`Vector ${i} has ${vec.length} dims, expected ${dims}. Mixed models?`)
      }
      for (let d = 0; d < dims; d++) mean[d] += vec[d]
    }
    return mean.map((sum) => Number((sum / count).toFixed(DECIMALS)))
  })

  // Placeholders keep each anchor on one line. Sixteen thousand lines of single
  // floats is a valid file and an unreadable diff.
  const staged = topics.map((topic, i) => ({
    name: topic.name,
    ink: topic.ink,
    anchorSentences: topic.anchorSentences,
    anchor: `__ANCHOR_${i}__`,
  }))
  const json = JSON.stringify(staged, null, 2).replace(
    /"__ANCHOR_(\d+)__"/g,
    (_, i: string) => `[${anchors[Number(i)].join(', ')}]`,
  )
  writeFileSync(TOPICS_PATH, `${json}\n`, 'utf8')

  console.log(`Wrote ${topics.length} anchors of ${dims} dims to data/topics.json.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
