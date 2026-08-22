import { FloorLine } from '@/components/FloorLine'

export const dynamic = 'force-dynamic'

type FloorPageProps = { params: Promise<{ batchId: string }> }

/**
 * The floor screen. It holds no state of its own: the run route sends the roster as the
 * first frame of the stream, so the line paints itself the moment the connection opens and
 * the page never has to load the work order twice.
 *
 * The footer that used to sit here is gone. It carried a certificate link that competed
 * with nothing while the line ran, because there is no certificate yet, and then competed
 * with the real one once the run landed. The floor now offers exactly one way out, and
 * only at the point where there is somewhere to go.
 */
export default async function FloorPage({ params }: FloorPageProps) {
  const { batchId } = await params

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-ground">
      <FloorLine batchId={batchId} />
    </main>
  )
}
