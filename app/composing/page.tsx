import { redirect } from 'next/navigation'
import Composing from '@/components/Composing'
import { MAX_CHARS, MIN_WORDS, countWords, normalise } from '@/lib/intake'

/**
 * The wait, on a screen of its own.
 *
 * The opinion travels in the query string rather than in memory, so a reload during the
 * eight seconds still has something to compose and the screen never renders empty. It is
 * cleaned here with the same function the front door and the intake route use, because a
 * sentence that arrives by hand in the address bar has to meet the same rules as one that
 * came off the form.
 *
 * Anything that cannot be composed goes back to the front door instead of being argued
 * with here. This screen has one job and no field to fix a sentence in.
 */

export default async function ComposingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const opinion = normalise(q ?? '')
  if (countWords(opinion) < MIN_WORDS || opinion.length > MAX_CHARS) redirect('/')

  return <Composing opinion={opinion} />
}
