'use client'

import type { Operator, Wing } from '@/lib/types'

/**
 * One instrument on the work order: what the planner picked, and why it picked it
 * for this text. The rationale is the load bearing part of this card. It is the only
 * proof on screen that the line was composed for the opinion in front of the reader
 * rather than printed from a template, so it gets the middle of the card and the
 * readable typeface, not a tooltip.
 */

export type GateOperator = Omit<Operator, 'run'> & {
  /** The planner's written reason for putting this instrument on this order. */
  rationale: string
  enabled: boolean
}

export type CardState = 'on' | 'off' | 'blocked'

const WING_TEXT: Record<Wing, string> = {
  field: 'text-wing-field',
  forensics: 'text-wing-forensics',
  semantics: 'text-wing-semantics',
  esoteric: 'text-wing-esoteric',
}

const WING_BORDER: Record<Wing, string> = {
  field: 'border-wing-field',
  forensics: 'border-wing-forensics',
  semantics: 'border-wing-semantics',
  esoteric: 'border-wing-esoteric',
}

const SWITCH_LABEL: Record<CardState, string> = { on: 'ON', off: 'OFF', blocked: 'HELD' }

/** "A", "A and B", "A, B and C". Used everywhere a list is read as a sentence. */
export function listOf(ids: string[]): string {
  if (ids.length <= 1) return ids.join('')
  return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`
}

type Props = {
  op: GateOperator
  state: CardState
  /** Needs that are not running, which is why this one is held back. */
  blockedBy: string[]
  /** True while the pointer sits on a switch whose flip would change this card. */
  inBlastRadius: boolean
  /** True while some switch is being previewed and this card is not affected by it. */
  faded: boolean
  locked: boolean
  onToggle: () => void
  onPreview: (previewing: boolean) => void
  anchor: (el: HTMLLIElement | null) => void
}

export default function OperatorCard({
  op,
  state,
  blockedBy,
  inBlastRadius,
  faded,
  locked,
  onToggle,
  onPreview,
  anchor,
}: Props) {
  const off = state !== 'on'
  const border = inBlastRadius
    ? 'border-signal'
    : off
      ? 'border-rule'
      : 'border-rule-bright'

  const writes = op.touches.length
    ? `writes ${op.touches.slice(0, 3).join(', ')}${op.touches.length > 3 ? ` and ${op.touches.length - 3} more` : ''}`
    : 'writes no render parameter'

  return (
    <li
      ref={anchor}
      data-op-id={op.id}
      data-state={state}
      className={`relative border ${border} bg-ground-raised px-4 py-3`}
      style={{
        opacity: faded ? 0.32 : off ? 0.55 : 1,
        transition: 'opacity var(--dur-press) ease, border-color var(--dur-press) ease',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] tracking-[0.09em] text-ink">{op.id}</div>
          <div className="truncate text-[11px] text-ink-dim">{op.name}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state === 'on'}
          aria-label={`${state === 'on' ? 'Switch off' : 'Switch on'} ${op.id}`}
          disabled={locked || state === 'blocked'}
          onClick={onToggle}
          onMouseEnter={() => onPreview(true)}
          onMouseLeave={() => onPreview(false)}
          onFocus={() => onPreview(true)}
          onBlur={() => onPreview(false)}
          className={`hoverable shrink-0 border px-2 py-1 text-[10px] tracking-[0.14em] ${
            state === 'on'
              ? 'border-state-ok text-state-ok'
              : state === 'blocked'
                ? 'border-rule text-ink-faint'
                : 'border-rule-bright text-ink-dim'
          } ${locked || state === 'blocked' ? 'cursor-not-allowed' : 'cursor-pointer hover:border-signal hover:text-signal'}`}
        >
          {SWITCH_LABEL[state]}
        </button>
      </div>

      <div className={`mt-3 text-[10px] tracking-[0.14em] ${WING_TEXT[op.wing]}`}>
        {op.wing.toUpperCase()} WING
      </div>

      <p
        className={`prose-sans mt-2 border-l-2 pl-3 text-ink ${WING_BORDER[op.wing]}`}
        style={{ fontSize: '12.5px', lineHeight: 1.55 }}
      >
        {op.rationale}
      </p>

      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-faint">
        <div className="flex gap-1">
          <dt>COST</dt>
          <dd className="text-ink-dim">{op.costUnits}u</dd>
        </div>
        <div className="flex gap-1">
          <dt>TIME</dt>
          <dd className="text-ink-dim">{op.estMs}ms</dd>
        </div>
        <div className="flex gap-1">
          <dt>OPS</dt>
          <dd className="text-ink-dim">{op.estOps}</dd>
        </div>
      </dl>

      <div className="mt-1 text-[10px] text-ink-faint">
        {op.needs.length ? `needs ${listOf([...new Set(op.needs)])}` : 'needs nothing'}
        {'. '}
        {writes}
        {'.'}
      </div>

      {state === 'blocked' && (
        <p className="mt-3 border-t border-rule pt-2 text-[11px] text-state-fail">
          Held back. {listOf(blockedBy)} {blockedBy.length > 1 ? 'are' : 'is'} switched off and this
          instrument reads {blockedBy.length > 1 ? 'them' : 'it'}.
        </p>
      )}

      {state === 'off' && (
        <p className="mt-3 border-t border-rule pt-2 text-[11px] text-ink-faint">
          Switched off by hand. It stays on the order, marked refused.
        </p>
      )}
    </li>
  )
}
