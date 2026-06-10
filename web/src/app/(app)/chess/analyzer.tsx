'use client'

import { Chess } from 'chess.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChessEngine } from '@/lib/chess/engine'
import {
  analyzeGame,
  uciToSan,
  winPercent,
  type Classification,
  type GameAnalysis,
  type MoveAnalysis,
  type PlayerSummary,
  type PositionEval,
} from '@/lib/chess/analyze'
import { Board } from './board'

const SAMPLE_PGN = `[White "You"]
[Black "Opponent"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7 Kxf7
7. Qf3+ Ke6 8. Nc3 Ncb4 9. a3 Nxc2+ 10. Kd1 Nxa1 11. Nxd5 *`

const CLASS_META: Record<Classification, { label: string; color: string }> = {
  best: { label: 'Best', color: 'var(--good)' },
  good: { label: 'Good', color: 'oklch(0.74 0.1 200)' },
  inaccuracy: { label: 'Inaccuracy', color: 'oklch(0.8 0.13 95)' },
  mistake: { label: 'Mistake', color: 'oklch(0.75 0.15 55)' },
  blunder: { label: 'Blunder', color: 'var(--danger)' },
}

function fmtEval(p: PositionEval | undefined): string {
  if (!p) return '0.0'
  if (p.mate !== null) {
    if (p.mate === 0) return '#'
    return p.mate > 0 ? `M${p.mate}` : `-M${Math.abs(p.mate)}`
  }
  const v = (p.cp ?? 0) / 100
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
}

export function ChessAnalyzer() {
  const [pgn, setPgn] = useState('')
  const [depth, setDepth] = useState(15)
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null)
  const [ply, setPly] = useState(0)
  const [flip, setFlip] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const engineRef = useRef<ChessEngine | null>(null)
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false })

  useEffect(() => {
    return () => {
      engineRef.current?.dispose()
    }
  }, [])

  const run = useCallback(async () => {
    if (running) return
    setError(null)
    setAnalysis(null)
    setProgress(0)
    setPly(0)
    const input = pgn.trim()
    if (!input) {
      setError('Paste a PGN first.')
      return
    }
    setRunning(true)
    abortRef.current = { aborted: false }
    try {
      if (!engineRef.current) engineRef.current = new ChessEngine()
      const result = await analyzeGame(input, engineRef.current, {
        depth,
        signal: abortRef.current,
        onProgress: (done, total) => setProgress(Math.round((done / total) * 100)),
      })
      setAnalysis(result)
      setPly(0)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'aborted') setError(msg.includes('Invalid') || msg.includes('PGN') ? `Couldn't read that PGN: ${msg}` : msg)
    } finally {
      setRunning(false)
    }
  }, [pgn, depth, running])

  const stop = useCallback(() => {
    abortRef.current.aborted = true
    engineRef.current?.dispose()
    engineRef.current = null
    setRunning(false)
  }, [])

  const totalPlies = analysis ? analysis.fens.length - 1 : 0
  const go = useCallback(
    (p: number) => setPly(Math.max(0, Math.min(totalPlies, p))),
    [totalPlies],
  )

  // keyboard navigation
  useEffect(() => {
    if (!analysis) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(ply - 1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(ply + 1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); go(0) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); go(totalPlies) }
      else if (e.key === 'f') setFlip((f) => !f)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [analysis, ply, totalPlies, go])

  const pos = analysis?.positions[ply]
  const lastMove = analysis && ply > 0 ? analysis.moves[ply - 1] : null
  const bestUci = pos?.bestMove
  const arrow = bestUci
    ? { from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), color: 'var(--good)' }
    : null
  const whitePct = pos ? winPercent(pos.whiteCp) : 50

  return (
    <div className="chess-layout">
      {/* ---------------- input column ---------------- */}
      <div className="stack gap16">
        <div className="box pad stack gap12">
          <div className="eyebrow">Paste PGN</div>
          <textarea
            className="chess-pgn"
            placeholder="Paste your game's PGN here…"
            value={pgn}
            onChange={(e) => setPgn(e.target.value)}
            spellCheck={false}
          />
          <div className="row between wrap gap12">
            <label className="row gap8" style={{ fontSize: 12, color: 'var(--muted)' }}>
              Depth
              <select
                className="chess-select"
                value={depth}
                onChange={(e) => setDepth(parseInt(e.target.value, 10))}
                disabled={running}
              >
                <option value={12}>12 · fast</option>
                <option value={15}>15 · balanced</option>
                <option value={18}>18 · deep</option>
                <option value={20}>20 · deepest</option>
              </select>
            </label>
            <div className="row gap8">
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setPgn(SAMPLE_PGN)}
                disabled={running}
              >
                Sample
              </button>
              {running ? (
                <button type="button" className="btn danger sm" onClick={stop}>
                  Stop
                </button>
              ) : (
                <button type="button" className="btn primary sm" onClick={run}>
                  Analyze
                </button>
              )}
            </div>
          </div>
          {running && (
            <div className="chess-progress">
              <i style={{ width: `${progress}%` }} />
              <span>Analyzing… {progress}%</span>
            </div>
          )}
          {error && <div className="note" style={{ borderColor: 'var(--danger-line)', color: 'var(--danger)' }}>{error}</div>}
          <div className="note">
            Runs Stockfish entirely in your browser — your PGN never leaves this machine. ← → to step moves, ↑/↓ to jump to start/end, <b>f</b> to flip board.
          </div>
        </div>

        {analysis && (
          <div className="g2 gap12">
            <SummaryCard title={analysis.headers.White || 'White'} summary={analysis.white} />
            <SummaryCard title={analysis.headers.Black || 'Black'} summary={analysis.black} />
          </div>
        )}
      </div>

      {/* ---------------- board column ---------------- */}
      <div className="stack gap12 chess-center">
        <div className="chess-board-row">
          <div className="chess-evalbar" title={`White win chance ≈ ${whitePct.toFixed(0)}%`}>
            <div className="fill" style={{ height: `${whitePct}%` }} />
            <span className="lbl">{fmtEval(pos)}</span>
          </div>
          <Board
            fen={pos?.fen ?? new Chess().fen()}
            lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : null}
            arrow={arrow}
            flip={flip}
          />
        </div>

        <div className="row between center">
          <div className="row gap6">
            <button className="btn ghost sm" onClick={() => go(0)} disabled={!analysis || ply === 0}>⏮</button>
            <button className="btn ghost sm" onClick={() => go(ply - 1)} disabled={!analysis || ply === 0}>◀</button>
            <button className="btn ghost sm" onClick={() => go(ply + 1)} disabled={!analysis || ply >= totalPlies}>▶</button>
            <button className="btn ghost sm" onClick={() => go(totalPlies)} disabled={!analysis || ply >= totalPlies}>⏭</button>
          </div>
          <button className="btn ghost sm" onClick={() => setFlip((f) => !f)} disabled={!analysis}>Flip</button>
        </div>

        {lastMove && (
          <MoveDetail move={lastMove} bestSan={lastMove.bestSan} />
        )}
        {analysis && pos?.bestMove && (
          <div className="note solid" style={{ width: '100%' }}>
            Best move now: <b>{pos.pv[0] ? sanOrUci(pos.fen, pos.bestMove) : pos.bestMove}</b>
            {pos.pv.length > 1 && <span style={{ color: 'var(--faint)' }}> &nbsp;line: {pvToText(pos.fen, pos.pv.slice(0, 5))}</span>}
          </div>
        )}
      </div>

      {/* ---------------- move list column ---------------- */}
      <div className="box pad stack gap8 chess-moves">
        <div className="eyebrow">Moves</div>
        {!analysis && <div className="note">Analysis will appear here.</div>}
        {analysis && (
          <div className="chess-movelist">
            {chunkPairs(analysis.moves).map(([w, b], i) => (
              <div className="chess-moverow" key={i}>
                <span className="num">{i + 1}.</span>
                {w ? <MoveChip move={w} active={ply === w.ply} onClick={() => go(w.ply)} /> : <span />}
                {b ? <MoveChip move={b} active={ply === b.ply} onClick={() => go(b.ply)} /> : <span />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MoveChip({ move, active, onClick }: { move: MoveAnalysis; active: boolean; onClick: () => void }) {
  const meta = CLASS_META[move.classification]
  return (
    <button type="button" className={`chess-move${active ? ' active' : ''}`} onClick={onClick}>
      <span className="dot" style={{ background: meta.color }} />
      {move.san}
    </button>
  )
}

function MoveDetail({ move, bestSan }: { move: MoveAnalysis; bestSan: string | null }) {
  const meta = CLASS_META[move.classification]
  const bad = move.classification === 'inaccuracy' || move.classification === 'mistake' || move.classification === 'blunder'
  return (
    <div className="box pad stack gap6" style={{ width: '100%', borderColor: bad ? meta.color : 'var(--line)' }}>
      <div className="row gap8 center wrap">
        <span className="chip" style={{ borderColor: meta.color, color: meta.color }}>
          <span className="dot" style={{ background: meta.color, width: 8, height: 8, borderRadius: 99, display: 'inline-block', marginRight: 6 }} />
          {meta.label}
        </span>
        <span style={{ fontWeight: 700 }}>{move.moveNumber}{move.color === 'w' ? '.' : '...'} {move.san}</span>
        {move.winDrop >= 1 && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>−{move.winDrop.toFixed(0)}% win chance</span>
        )}
      </div>
      {bad && bestSan && move.bestMove !== move.lan && (
        <div style={{ fontSize: 13 }}>
          Better was <b style={{ color: 'var(--good)' }}>{bestSan}</b>.
        </div>
      )}
    </div>
  )
}

function SummaryCard({ title, summary }: { title: string; summary: PlayerSummary }) {
  return (
    <div className="box pad stack gap8">
      <div className="row between center">
        <span style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span className="chip" style={{ borderColor: 'var(--accent-line)' }}>{summary.accuracy.toFixed(1)}%</span>
      </div>
      <div className="chess-counts">
        <Count n={summary.blunder} label="Blunders" color="var(--danger)" />
        <Count n={summary.mistake} label="Mistakes" color="oklch(0.75 0.15 55)" />
        <Count n={summary.inaccuracy} label="Inaccuracies" color="oklch(0.8 0.13 95)" />
      </div>
    </div>
  )
}

function Count({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div className="chess-count">
      <span className="v" style={{ color: n > 0 ? color : 'var(--faint)' }}>{n}</span>
      <span className="l">{label}</span>
    </div>
  )
}

// ---- small helpers ----
function chunkPairs(moves: MoveAnalysis[]): [MoveAnalysis | null, MoveAnalysis | null][] {
  const out: [MoveAnalysis | null, MoveAnalysis | null][] = []
  for (let i = 0; i < moves.length; i += 2) {
    out.push([moves[i] ?? null, moves[i + 1] ?? null])
  }
  return out
}

function sanOrUci(fen: string, uci: string): string {
  return uciToSan(fen, uci) ?? uci
}

function pvToText(fen: string, pv: string[]): string {
  const c = new Chess(fen)
  const parts: string[] = []
  for (const uci of pv) {
    try {
      const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined })
      if (!m) break
      parts.push(m.san)
    } catch {
      break
    }
  }
  return parts.join(' ')
}
