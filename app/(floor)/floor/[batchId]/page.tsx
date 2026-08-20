import Link from 'next/link'
import { FloorLine } from '@/components/FloorLine'

export const dynamic = 'force-dynamic'

type FloorPageProps = { params: Promise<{ batchId: string }> }

/**
 * The floor screen. It holds no state of its own: the run route sends the roster as the
 * first frame of the stream, so the line paints itself the moment the connection opens and
 * the page never has to load the work order twice.
 */
export default async function FloorPage({ params }: FloorPageProps) {
  const { batchId } = await params

  return (
    <main className="flex min-h-screen flex-col bg-ground">
      <FloorLine batchId={batchId} />
      <footer className="border-t border-rule px-4 py-3 text-[11px] text-ink-faint sm:px-8">
        <Link href={`/certificate/${batchId}`} className="hoverable text-ink-dim">
          Certificate
        </Link>
        <span className="ml-4">Every operation on this screen is recorded against {batchId}.</span>
      </footer>
    </main>
  )
}
