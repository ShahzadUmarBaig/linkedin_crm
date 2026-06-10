'use client'

import { useCallback, useRef } from 'react'
import { winPercent, type MoveAnalysis, type PositionEval } from '@/lib/chess/analyze'
import { CLASS_META, isMistake } from './labels'

/**
 * chess.com-style advantage graph. The white area grows downward as White's
 * win-chance rises. Every move is a colored dot; the whole strip is clickable /
 * draggable to scrub to any position.
 */
export function EvalGraph({
  positions,
  moves,
  ply,
  onSeek,
}: {
  positions: PositionEval[]
  moves: MoveAnalysis[]
  ply: number
  onSeek: (ply: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const n = positions.length - 1
  if (n < 1) return null

  const wp = positions.map((p) => winPercent(p.whiteCp)) // 0..100, White POV

  // area polygon (viewBox 0..n x 0..100); white fills from top down to the curve
  const top = `0,0 ${wp.map((v, i) => `${i},${v.toFixed(2)}`).join(' ')} ${n},0`
  const curve = wp.map((v, i) => `${i},${v.toFixed(2)}`).join(' ')

  const seekFromX = useCallback(
    (clientX: number) => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
      onSeek(Math.round(ratio * n))
    },
    [n, onSeek],
  )

  return (
    <div
      ref={ref}
      className="cb-graph"
      onPointerDown={(e) => {
        dragging.current = true
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        seekFromX(e.clientX)
      }}
      onPointerMove={(e) => dragging.current && seekFromX(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
    >
      <svg className="cb-graph-svg" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none">
        <polygon points={top} fill="#ededf2" />
        <polyline
          points={curve}
          fill="none"
          stroke="#7c7c8a"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          opacity={0.5}
        />
        <line x1={0} y1={50} x2={n} y2={50} stroke="#000" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.18} />
      </svg>

      {/* current-move cursor */}
      <div className="cb-graph-cursor" style={{ left: `${(ply / n) * 100}%` }} />

      {/* move dots — only notable moves get a visible dot, keeps it readable */}
      {moves.map((m) => {
        if (!isMistake(m.classification)) return null
        const meta = CLASS_META[m.classification]
        return (
          <button
            key={m.ply}
            type="button"
            className="cb-graph-dot"
            title={`${m.moveNumber}${m.color === 'w' ? '.' : '…'} ${m.san} — ${meta.label}`}
            style={{
              left: `${(m.ply / n) * 100}%`,
              top: `${wp[m.ply]}%`,
              background: meta.color,
            }}
            onClick={(e) => {
              e.stopPropagation()
              onSeek(m.ply)
            }}
          />
        )
      })}
    </div>
  )
}
