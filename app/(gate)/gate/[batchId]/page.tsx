import Link from 'next/link'
import { notFound } from 'next/navigation'
import '@/lib/operators'
import { gateDb } from '@/app/api/plan/db'
import PlanBoard from '@/components/PlanBoard'
import WorkOrderDag, { type GateOperator } from '@/components/WorkOrderDag'
import { getWorkOrder } from '@/lib/db'
import { getOperator } from '@/lib/operators/registry'

/**
 * The gate. A person reads a plan an agent wrote and takes responsibility for it.
 *
 * Two views of the same order. The default is four steps in plain words, which is what
 * a stranger can read in a room in ten seconds. `?detail=1` is the full graph with every
 * switch on it, for the question that always comes: what happens if I turn one off.
 * Both post the same signature to the same route, so neither can drift from the other.
 *
 * The order is read from the database rather than handed over from the intake screen,
 * so a refresh in the middle of a demo shows the same plan instead of composing a
 * second one, and the link can be passed to somebody else.
 */

export const dynamic = 'force-dynamic'

export default async function GatePage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>
  searchParams: Promise<{ detail?: string }>
}) {
  const { batchId } = await params
  const { detail } = await searchParams
  const row = getWorkOrder(gateDb(), batchId)
  if (!row) notFound()

  const { order, signedAt } = row

  // An id on the order that the factory no longer registers is a fact the signer needs
  // in front of them, not a crash. The rest of the plan still draws.
  const missing: string[] = []
  const operators: GateOperator[] = []
  for (const entry of order.operators) {
    let op
    try {
      op = getOperator(entry.id)
    } catch {
      missing.push(entry.id)
      continue
    }
    operators.push({
      id: op.id,
      name: op.name,
      wing: op.wing,
      blurb: op.blurb,
      needs: op.needs,
      costUnits: op.costUnits,
      estMs: op.estMs,
      estOps: op.estOps,
      touches: op.touches,
      rationale: entry.rationale,
      enabled: entry.enabled,
    })
  }

  const note =
    missing.length > 0 ? (
      <p className="gate-missing">
        The planner listed {missing.join(', ')}, and the factory does not register{' '}
        {missing.length > 1 ? 'those tools' : 'that tool'} any more. It cannot be signed for and
        is left off the plan below.
      </p>
    ) : null

  if (detail !== '1') {
    return (
      <>
        {note}
        <PlanBoard
          batchId={order.batchId}
          opinion={order.opinion}
          operators={operators}
          estMs={order.estMs}
          signedAt={signedAt}
        />
      </>
    )
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-4">
        <div className="flex items-baseline gap-4">
          <Link href="/" className="text-[15px] tracking-[0.34em] text-ink">
            DOXA
          </Link>
          <span className="text-[10px] tracking-[0.16em] text-signal">EVERY TOOL</span>
          <Link
            href={`/gate/${order.batchId}`}
            className="text-[10px] tracking-[0.14em] text-ink-faint no-underline hover:text-ink"
          >
            BACK TO THE PLAN
          </Link>
        </div>
        <dl className="flex flex-wrap gap-x-7 gap-y-1 text-[10px]">
          <div className="flex gap-2">
            <dt className="text-ink-faint">BATCH</dt>
            <dd className="text-ink">{order.batchId}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-faint">AS PLANNED</dt>
            <dd className="text-ink-dim">
              {order.operators.length} tools, {order.estCostUnits}u, {order.estMs}ms,{' '}
              {order.estOps} ops
            </dd>
          </div>
        </dl>
      </header>

      <section className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <h2 className="text-[10px] tracking-[0.16em] text-ink-faint">THE OPINION</h2>
          <blockquote
            className="prose-sans mt-3 border-l-2 border-signal pl-4 text-ink"
            style={{ fontSize: '17px', lineHeight: 1.55 }}
          >
            {order.opinion}
          </blockquote>
        </div>
        <div>
          <h2 className="text-[10px] tracking-[0.16em] text-ink-faint">WHY THIS LINE</h2>
          <p className="prose-sans mt-3 text-ink-dim" style={{ fontSize: '12.5px' }}>
            {order.plannerNotes}
          </p>
        </div>
      </section>

      {note}

      <section className="mt-9">
        <h2 className="mb-4 text-[10px] tracking-[0.16em] text-ink-faint">
          THE LINE, LEFT TO RIGHT. EACH LAYER RUNS AT ONCE.
        </h2>
        <WorkOrderDag batchId={order.batchId} operators={operators} signedAt={signedAt} />
      </section>
    </main>
  )
}
