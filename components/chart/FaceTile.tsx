'use client'

import { useEffect, useRef } from 'react'
import type { Face } from '@/lib/face/plate'
import { PLATE, strikeFace, wholeScale } from './paintFace'

/**
 * One face, on its own, at the largest whole scale that fits `box`.
 *
 * The side panel's copy of the node. Same strike, same rule about whole scales, so the face
 * a person clicked and the face they are now reading are provably the same picture.
 */
export function FaceTile({ face, box, ground = '#070708' }: { face: Face; box: number; ground?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const scale = wholeScale(box)
  const size = PLATE * scale

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1))
    canvas.width = size * dpr
    canvas.height = size * dpr

    ctx.imageSmoothingEnabled = false
    ctx.drawImage(strikeFace(face, ground), 0, 0, size * dpr, size * dpr)
  }, [face, size, ground])

  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size, imageRendering: 'pixelated', display: 'block' }}
      aria-hidden
    />
  )
}
