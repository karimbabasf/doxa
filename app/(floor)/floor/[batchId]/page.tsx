import Link from 'next/link'
import FloorBoard from '@/components/FloorBoard'
import { FloorLine } from '@/components/FloorLine'

export const dynamic = 'force-dynamic'

type FloorPageProps = {
  params: Promise<{ batchId: string }>
  searchParams: Promise<{ detail?: string }>
}

/**
 * The floor screen. It holds no state of its own: the run route sends the roster as the
 * first frame of the stream, so the line paints itself the moment the connection opens and
 * the page never has to load the work order twice.
 *
 * Two views over the one run, matching the gate. The board is the four steps the person
 * signed for, actually happening. `?detail=1` is one row per operator with every reading,
 * for the question a judge asks after the demo rather than during it.
 */
export default async function FloorPage({ params, searchParams }: FloorPageProps) {
  const { batchId } = await params
  const { detail } = await searchParams

  if (detail !== '1') return <FloorBoard batchId={batchId} />

  return (
    <main className="flex min-h-screen flex-col bg-ground">
      <FloorLine batchId={batchId} />
      <footer className="border-t border-rule px-4 py-3 text-[11px] text-ink-faint sm:px-8">
        <Link href={`/floor/${batchId}`} className="hoverable text-ink-dim">
          Back to the four steps
        </Link>
        <Link href={`/certificate/${batchId}`} className="hoverable ml-4 text-ink-dim">
          Certificate
        </Link>
        <span className="ml-4">Every operation on this screen is recorded against {batchId}.</span>
      </footer>
    </main>
  )
}
