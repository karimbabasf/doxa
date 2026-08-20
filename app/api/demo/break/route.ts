import { NextResponse } from 'next/server'
import { demoDb, priceClassName, readBreak, setBreak, type DemoBreak } from '@/lib/demo/state'

/*
 * The break a judge presses. POST breaks the shop page, DELETE restores it, GET reports
 * the flag. The restore path matters as much as the break: a rehearsal has to put the
 * page back in one click, not a redeploy.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

function body(state: DemoBreak) {
  return {
    broken: state.broken,
    changedAt: state.changedAt,
    priceClass: priceClassName(state.broken),
  }
}

export async function GET() {
  return NextResponse.json(body(readBreak(demoDb())), { headers: NO_STORE })
}

export async function POST() {
  return NextResponse.json(body(setBreak(demoDb(), true)), { headers: NO_STORE })
}

export async function DELETE() {
  return NextResponse.json(body(setBreak(demoDb(), false)), { headers: NO_STORE })
}
