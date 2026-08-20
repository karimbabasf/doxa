'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The running total of operations the floor has performed.
 *
 * The value is redrawn many times a second, so nothing here uses a CSS transition: a
 * transition on a fast number reads as lag. The count-up is done by writing a new number
 * every frame instead, which is the readout moving rather than the pixels catching up.
 */
export function OpCounter({
  value,
  label = 'operations',
  size = 'lg',
}: {
  value: number
  label?: string
  size?: 'lg' | 'sm'
}) {
  const [shown, setShown] = useState(0)
  const shownRef = useRef(0)

  useEffect(() => {
    const from = shownRef.current
    if (from === value) return

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      shownRef.current = value
      setShown(value)
      return
    }

    // 400ms of ramp per step, decelerating, so a jump of 900 ops reads as a machine
    // counting rather than a number teleporting.
    const startedAt = performance.now()
    let frame = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - startedAt) / 400)
      const eased = 1 - Math.pow(1 - p, 3)
      const next = Math.round(from + (value - from) * eased)
      shownRef.current = next
      setShown(next)
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])

  return (
    <div className="flex flex-col items-end">
      <span
        className={
          size === 'lg'
            ? 'text-[38px] leading-none font-medium tracking-tight text-ink'
            : 'text-[18px] leading-none font-medium text-ink'
        }
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {shown.toLocaleString('en-US')}
      </span>
      <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-ink-faint">{label}</span>
    </div>
  )
}

export default OpCounter
