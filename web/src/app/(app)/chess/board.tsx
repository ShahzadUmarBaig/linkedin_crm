'use client'

import { Chess } from 'chess.js'
import { useMemo } from 'react'

const GLYPH: Record<string, string> = {
  wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
  bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚',
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

export interface Arrow {
  from: string
  to: string
  color: string
}

function squareToXY(square: string, flip: boolean): { x: number; y: number } {
  const file = FILES.indexOf(square[0])
  const rank = parseInt(square[1], 10) - 1 // 0 = rank 1
  const col = flip ? 7 - file : file
  const row = flip ? rank : 7 - rank // row 0 = top
  return { x: col + 0.5, y: row + 0.5 } // in board units (0..8)
}

/**
 * Self-contained chessboard rendered from a FEN. No external board library —
 * pieces are Unicode glyphs, last move + best-move drawn as SVG overlays so it
 * survives React 19 / Next 16 without peer-dependency churn.
 */
export function Board({
  fen,
  lastMove,
  arrow,
  flip = false,
}: {
  fen: string
  lastMove?: { from: string; to: string } | null
  arrow?: Arrow | null
  flip?: boolean
}) {
  const grid = useMemo(() => {
    try {
      return new Chess(fen).board() // 8x8, row 0 = rank 8
    } catch {
      return null
    }
  }, [fen])

  if (!grid) return null

  const rows = flip ? [...grid].reverse() : grid
  const lastSet = new Set(lastMove ? [lastMove.from, lastMove.to] : [])

  return (
    <div className="cb-wrap">
      <div className="cb">
        {rows.map((row, ri) => {
          const cells = flip ? [...row].reverse() : row
          return cells.map((piece, ci) => {
            // reconstruct algebraic square name for highlight lookup
            const fileIdx = flip ? 7 - ci : ci
            const rankIdx = flip ? ri : 7 - ri
            const square = `${FILES[fileIdx]}${rankIdx + 1}`
            const dark = (fileIdx + rankIdx) % 2 === 0
            return (
              <div
                key={square}
                className={`cb-sq ${dark ? 'dk' : 'lt'}${lastSet.has(square) ? ' last' : ''}`}
              >
                {ci === 0 && <span className="cb-rank">{rankIdx + 1}</span>}
                {ri === 7 && <span className="cb-file">{FILES[fileIdx]}</span>}
                {piece && (
                  <span className={`cb-pc ${piece.color === 'w' ? 'cb-w' : 'cb-b'}`}>
                    {GLYPH[`${piece.color}${piece.type}`]}
                  </span>
                )}
              </div>
            )
          })
        })}
      </div>

      {arrow && (
        <svg className="cb-arrows" viewBox="0 0 8 8" preserveAspectRatio="none">
          <ArrowLine from={arrow.from} to={arrow.to} color={arrow.color} flip={flip} />
        </svg>
      )}
    </div>
  )
}

function ArrowLine({ from, to, color, flip }: { from: string; to: string; color: string; flip: boolean }) {
  const a = squareToXY(from, flip)
  const b = squareToXY(to, flip)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  // shorten the tail/head so it sits nicely inside squares
  const sx = a.x + ux * 0.32
  const sy = a.y + uy * 0.32
  const ex = b.x - ux * 0.34
  const ey = b.y - uy * 0.34
  const headId = `ah-${from}-${to}`
  return (
    <>
      <defs>
        <marker id={headId} markerWidth="3" markerHeight="3" refX="1.6" refY="1.5" orient="auto">
          <path d="M0,0 L3,1.5 L0,3 z" fill={color} />
        </marker>
      </defs>
      <line
        x1={sx}
        y1={sy}
        x2={ex}
        y2={ey}
        stroke={color}
        strokeWidth={0.16}
        strokeLinecap="round"
        markerEnd={`url(#${headId})`}
        opacity={0.85}
      />
    </>
  )
}
