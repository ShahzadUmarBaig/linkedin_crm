'use client'

import { Chess } from 'chess.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChessEngine } from '@/lib/chess/engine'
import {
  analyzeGame,
  fmtClock,
  uciToSan,
  winPercent,
  CLASS_ORDER,
  type GameAnalysis,
  type MoveAnalysis,
  type PlayerSummary,
  type PositionEval,
} from '@/lib/chess/analyze'
import { Board } from './board'
import { EvalGraph } from './eval-graph'
import { CLASS_META, isMistake } from './labels'

const SAMPLE_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[White "macesun"]
[Black "Shahzad-Umar-Baig"]
[Result "0-1"]
[TimeControl "600"]
[WhiteElo "550"]
[BlackElo "587"]
[Termination "Shahzad-Umar-Baig won by checkmate"]
[ECO "A00"]

1. d3 {[%clk 0:09:58.8]} 1... e5 {[%clk 0:09:52.7]} 2. e3 {[%clk 0:09:57.9]} 2... d6 {[%clk 0:09:50.7]} 3. Ne2 {[%clk 0:09:56.8]} 3... Qf6 {[%clk 0:09:11]} 4. Nd2 {[%clk 0:09:51.3]} 4... Bg4 {[%clk 0:09:08.4]} 5. Ne4 {[%clk 0:09:08.2]} 5... Qe7 {[%clk 0:07:57.6]} 6. f3 {[%clk 0:08:41]} 6... Bf5 {[%clk 0:07:49.4]} 7. N2g3 {[%clk 0:08:32.5]} 7... Bxe4 {[%clk 0:07:35.6]} 8. Nxe4 {[%clk 0:08:29.3]} 8... d5 {[%clk 0:07:25.6]} 9. Nc3 {[%clk 0:08:22.6]} 9... d4 {[%clk 0:07:15.2]} 10. Nb1 {[%clk 0:07:58.8]} 10... dxe3 {[%clk 0:07:09.6]} 11. Bxe3 {[%clk 0:07:52.9]} 11... Nc6 {[%clk 0:06:41.5]} 12. c3 {[%clk 0:07:40.4]} 12... O-O-O {[%clk 0:06:39.2]} 13. d4 {[%clk 0:07:39.1]} 13... exd4 {[%clk 0:06:29.8]} 14. Qe2 {[%clk 0:05:00.4]} 14... dxe3 {[%clk 0:06:12.7]} 15. Nd2 {[%clk 0:04:37.1]} 15... Rxd2 {[%clk 0:06:07.8]} 16. Qxd2 {[%clk 0:04:12.4]} 16... exd2+ {[%clk 0:05:59.5]} 17. Kxd2 {[%clk 0:04:11.3]} 17... Qg5+ {[%clk 0:05:54]} 18. Kc2 {[%clk 0:04:08.8]} 18... Qf5+ {[%clk 0:05:24.9]} 19. Kb3 {[%clk 0:04:04.8]} 19... Na5+ {[%clk 0:04:36.3]} 20. Ka4 {[%clk 0:03:49]} 20... b5+ {[%clk 0:04:33]} 21. Kxa5 {[%clk 0:03:46.2]} 21... b4+ {[%clk 0:04:27.7]} 22. Ka4 {[%clk 0:03:43.8]} 22... c5 {[%clk 0:04:01.7]} 23. Re1 {[%clk 0:03:38.6]} 23... Kd8 {[%clk 0:03:34.5]} 24. Bc4 {[%clk 0:03:22.9]} 24... Nf6 {[%clk 0:03:22.2]} 25. Bxf7 {[%clk 0:03:06.2]} 25... Qd7+ {[%clk 0:03:15.7]} 26. Kb3 {[%clk 0:03:03.3]} 26... Qxf7+ {[%clk 0:03:14.8]} 27. Ka4 {[%clk 0:02:59.3]} 27... Nd5 {[%clk 0:03:10.7]} 28. Re2 {[%clk 0:02:57.9]} 28... Nb6+ {[%clk 0:03:05.2]} 29. Ka5 {[%clk 0:02:56.3]} 29... Qd7 {[%clk 0:02:54.5]} 30. Rhe1 {[%clk 0:02:54.1]} 30... Qa4# {[%clk 0:02:53.1]} 0-1`

function fmtEval(p: PositionEval | undefined): string {
  if (!p) return '0.0'
  if (p.mate !== null) {
    if (p.mate === 0) return '#'
    return p.mate > 0 ? `M${p.mate}` : `-M${Math.abs(p.mate)}`
  }
  const v = (p.cp ?? 0) / 100
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
}

function parseBaseSeconds(tc: string | undefined): number | null {
  if (!tc) return null
  const m = tc.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

function replayLine(fen: string, ucis: string[]): { fen: string; lastMove: { from: string; to: string } | null } {
  const c = new Chess(fen)
  let lastMove: { from: string; to: string } | null = null
  for (const u of ucis) {
    try {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined })
      if (!m) break
      lastMove = { from: m.from, to: m.to }
    } catch {
      break
    }
  }
  return { fen: c.fen(), lastMove }
}

function pvToSan(fen: string, pv: string[], max = 6): string {
  const c = new Chess(fen)
  const parts: string[] = []
  for (const uci of pv.slice(0, max)) {
    try {
      const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined })
      if (!mv) break
      parts.push(mv.san)
    } catch {
      break
    }
  }
  return parts.join(' ')
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
  const [explain, setExplain] = useState<{ baseFen: string; line: string[]; label: string; evalText: string } | null>(null)
  const [explainIdx, setExplainIdx] = useState(0)

  const engineRef = useRef<ChessEngine | null>(null)
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false })

  useEffect(() => () => engineRef.current?.dispose(), [])

  const run = useCallback(async () => {
    if (running) return
    setError(null)
    setProgress(0)
    const input = pgn.trim()
    if (!input) {
      setError('Paste a PGN first.')
      return
    }
    setRunning(true)
    setAnalysis(null)
    abortRef.current = { aborted: false }
    try {
      if (!engineRef.current) engineRef.current = new ChessEngine()
      const result = await analyzeGame(input, engineRef.current, {
        depth,
        multiPV: 2,
        signal: abortRef.current,
        onProgress: (done, total) => setProgress(Math.round((done / total) * 100)),
      })
      setAnalysis(result)
      setPly(0)
      // Put the side that lost / the human at the bottom if we can guess (Black here often)
      setFlip(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'aborted') setError(msg)
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
  const go = useCallback((p: number) => { setExplain(null); setPly(Math.max(0, Math.min(totalPlies, p))) }, [totalPlies])

  const startExplain = useCallback((m: MoveAnalysis, before: PositionEval) => {
    const line = before.pv.length ? before.pv : before.bestMove ? [before.bestMove] : []
    if (!line.length) return
    setExplain({
      baseFen: before.fen,
      line,
      label: `Best for ${m.color === 'w' ? 'White' : 'Black'} was ${before.bestMove ? uciToSan(before.fen, before.bestMove) ?? '' : ''}`,
      evalText: fmtEval(before),
    })
    setExplainIdx(1)
  }, [])

  useEffect(() => {
    if (!analysis) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      if (explain) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); setExplainIdx((i) => Math.max(0, i - 1)) }
        else if (e.key === 'ArrowRight') { e.preventDefault(); setExplainIdx((i) => Math.min(explain.line.length, i + 1)) }
        else if (e.key === 'Escape') setExplain(null)
        return
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(ply - 1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(ply + 1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); go(0) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); go(totalPlies) }
      else if (e.key === 'f') setFlip((f) => !f)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [analysis, ply, totalPlies, go, explain])

  // ----- input view -----
  if (!analysis) {
    return (
      <div className="chess-input-hero">
        <div className="box pad-lg stack gap12" style={{ width: 'min(680px, 100%)' }}>
          <div className="eyebrow">Game review · paste PGN</div>
          <textarea
            className="chess-pgn"
            placeholder="Paste your chess.com / lichess PGN here…"
            value={pgn}
            onChange={(e) => setPgn(e.target.value)}
            spellCheck={false}
            disabled={running}
          />
          <div className="row between wrap gap12">
            <label className="row gap8" style={{ fontSize: 12, color: 'var(--muted)' }}>
              Engine depth
              <select className="chess-select" value={depth} onChange={(e) => setDepth(parseInt(e.target.value, 10))} disabled={running}>
                <option value={12}>12 · fast</option>
                <option value={15}>15 · balanced</option>
                <option value={18}>18 · deep</option>
                <option value={20}>20 · deepest</option>
              </select>
            </label>
            <div className="row gap8">
              <button className="btn ghost sm" onClick={() => setPgn(SAMPLE_PGN)} disabled={running}>Sample</button>
              {running ? (
                <button className="btn danger sm" onClick={stop}>Stop</button>
              ) : (
                <button className="btn primary sm" onClick={run}>Analyze game</button>
              )}
            </div>
          </div>
          {running && (
            <div className="chess-progress">
              <i style={{ width: `${progress}%` }} />
              <span>Analyzing with Stockfish… {progress}%</span>
            </div>
          )}
          {error && <div className="note" style={{ borderColor: 'var(--danger-line)', color: 'var(--danger)' }}>{error}</div>}
          <div className="note">
            Stockfish runs entirely in your browser — your PGN never leaves this machine. For per-move time used, paste chess.com&apos;s full <b>Download PGN</b> (it includes <code>[%clk]</code> tags).
          </div>
        </div>
      </div>
    )
  }

  // ----- review view -----
  const pos = analysis.positions[ply]
  const move = ply > 0 ? analysis.moves[ply - 1] : null
  const bestUci = pos?.bestMove
  const arrow = bestUci ? { from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), color: 'oklch(0.74 0.13 152)' } : null
  const whitePct = pos ? winPercent(pos.whiteCp) : 50

  const bottomColor: 'w' | 'b' = flip ? 'b' : 'w'
  const topColor: 'w' | 'b' = flip ? 'w' : 'b'
  const baseSecs = parseBaseSeconds(analysis.headers.TimeControl)

  const clockFor = (color: 'w' | 'b'): number | null => {
    let last: number | null = baseSecs
    for (const m of analysis.moves) {
      if (m.ply > ply) break
      if (m.color === color && m.clockSeconds != null) last = m.clockSeconds
    }
    return analysis.hasClocks ? last : baseSecs
  }

  const playerOf = (c: 'w' | 'b') => (c === 'w' ? analysis.white : analysis.black)

  const explainView = explain ? replayLine(explain.baseFen, explain.line.slice(0, explainIdx)) : null
  const boardFen = explainView ? explainView.fen : pos?.fen ?? new Chess().fen()
  const boardLast = explainView ? explainView.lastMove : move ? { from: move.from, to: move.to } : null
  const boardArrow = explain ? null : arrow

  return (
    <div className="chess-review">
      {/* ---- board column ---- */}
      <div className="chess-board-col">
        <PlayerTag p={playerOf(topColor)} clock={clockFor(topColor)} toMove={boardFen.split(' ')[1] === topColor} />
        {explain && (
          <div className="chess-explain-banner">
            <span className="lbl">💡 {explain.label}</span>
            <span className="ev">{explain.evalText}</span>
            <div className="row gap6">
              <button className="btn ghost sm" onClick={() => setExplainIdx((i) => Math.max(0, i - 1))} disabled={explainIdx === 0}>◀</button>
              <button className="btn ghost sm" onClick={() => setExplainIdx((i) => Math.min(explain.line.length, i + 1))} disabled={explainIdx >= explain.line.length}>▶</button>
              <button className="btn good sm" onClick={() => setExplain(null)}>Got it</button>
            </div>
          </div>
        )}
        <div className="chess-board-row">
          <div className="chess-evalbar" title={`White win chance ≈ ${whitePct.toFixed(0)}%`}>
            <div className="fill" style={{ height: `${whitePct}%` }} />
            <span className="lbl" style={{ top: whitePct > 50 ? 4 : undefined, bottom: whitePct > 50 ? undefined : 4, color: whitePct > 50 ? '#14141a' : '#e9e9ee' }}>{fmtEval(pos)}</span>
          </div>
          <Board fen={boardFen} lastMove={boardLast} arrow={boardArrow} flip={flip} />
        </div>
        <PlayerTag p={playerOf(bottomColor)} clock={clockFor(bottomColor)} toMove={boardFen.split(' ')[1] === bottomColor} />

        <div className="row between center" style={{ marginTop: 4 }}>
          <div className="row gap6">
            <button className="btn ghost sm" onClick={() => go(0)} disabled={ply === 0}>⏮</button>
            <button className="btn ghost sm" onClick={() => go(ply - 1)} disabled={ply === 0}>◀</button>
            <button className="btn ghost sm" onClick={() => go(ply + 1)} disabled={ply >= totalPlies}>▶</button>
            <button className="btn ghost sm" onClick={() => go(totalPlies)} disabled={ply >= totalPlies}>⏭</button>
          </div>
          <div className="row gap6">
            <button className="btn ghost sm" onClick={() => setFlip((f) => !f)}>Flip</button>
            <button className="btn ghost sm" onClick={() => { setAnalysis(null); setError(null) }}>New game</button>
          </div>
        </div>
      </div>

      {/* ---- review panel ---- */}
      <div className="chess-panel">
        <div className="chess-panel-head">
          <span className="chess-panel-title">Game Review</span>
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>
            {analysis.result}{analysis.eco ? ` · ${analysis.eco}` : ''}{analysis.hasClocks ? '' : ' · no clocks'}
          </span>
        </div>

        <div className="chess-acc-row">
          <AccBox p={analysis.white} />
          <div className="chess-acc-mid">Accuracy</div>
          <AccBox p={analysis.black} right />
        </div>

        <EvalGraph positions={analysis.positions} moves={analysis.moves} ply={ply} onSeek={go} />

        {move ? (
          <MoveDetail
            move={move}
            before={analysis.positions[ply - 1]}
            after={analysis.positions[ply]}
            onExplain={() => startExplain(move, analysis.positions[ply - 1])}
            explaining={!!explain}
          />
        ) : (
          <div className="note solid">Starting position. Use ← → or click the graph / a move to step through.</div>
        )}

        <CountsTable white={analysis.white} black={analysis.black} />

        <div className="chess-movelist">
          {chunkPairs(analysis.moves).map(([w, b], i) => (
            <div className="chess-moverow" key={i}>
              <span className="num">{i + 1}.</span>
              {w ? <MoveChip move={w} active={ply === w.ply} onClick={() => go(w.ply)} /> : <span />}
              {b ? <MoveChip move={b} active={ply === b.ply} onClick={() => go(b.ply)} /> : <span />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PlayerTag({ p, clock, toMove }: { p: PlayerSummary; clock: number | null; toMove: boolean }) {
  return (
    <div className={`chess-player${toMove ? ' tomove' : ''}`}>
      <span className="av">{(p.name[0] ?? '?').toUpperCase()}</span>
      <span className="nm">{p.name}</span>
      {p.elo && <span className="elo">{p.elo}</span>}
      <span className="clk">{fmtClock(clock)}</span>
    </div>
  )
}

function AccBox({ p, right }: { p: PlayerSummary; right?: boolean }) {
  return (
    <div className={`chess-accbox${right ? ' r' : ''}`}>
      <span className="who">{p.name}{p.elo ? ` (${p.elo})` : ''}</span>
      <span className="val">{p.accuracy.toFixed(1)}</span>
    </div>
  )
}

function CountsTable({ white, black }: { white: PlayerSummary; black: PlayerSummary }) {
  return (
    <div className="chess-counts-table">
      {CLASS_ORDER.map((c) => {
        const meta = CLASS_META[c]
        return (
          <div className="chess-counts-row" key={c}>
            <span className="w" style={{ color: white[c] > 0 ? meta.color : 'var(--faint)' }}>{white[c]}</span>
            <span className="mid">
              <span className="badge" style={{ background: meta.color }}>{meta.glyph}</span>
              {meta.label}
            </span>
            <span className="b" style={{ color: black[c] > 0 ? meta.color : 'var(--faint)' }}>{black[c]}</span>
          </div>
        )
      })}
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

function MoveDetail({
  move,
  before,
  after,
  onExplain,
  explaining,
}: {
  move: MoveAnalysis
  before: PositionEval
  after: PositionEval
  onExplain: () => void
  explaining: boolean
}) {
  const meta = CLASS_META[move.classification]
  const bad = isMistake(move.classification)
  const playedBest = before.bestMove === move.lan

  const betterLine = useMemo(
    () => (before.bestMove ? pvToSan(before.fen, before.pv.length ? before.pv : [before.bestMove], 6) : ''),
    [before],
  )
  const refutation = useMemo(() => pvToSan(after.fen, after.pv, 6), [after])
  const bestSan = before.bestMove ? uciToSan(before.fen, before.bestMove) : null

  return (
    <div className="chess-detail" style={{ borderColor: bad ? meta.color : 'var(--line)' }}>
      <div className="row gap8 center wrap between">
        <div className="row gap8 center">
          <span className="badge lg" style={{ background: meta.color }}>{meta.glyph}</span>
          <span style={{ fontWeight: 700 }}>{move.moveNumber}{move.color === 'w' ? '.' : '…'} {move.san}</span>
          <span style={{ fontSize: 12, color: meta.color }}>{meta.label}</span>
        </div>
        <div className="row gap8 center">
          <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            {move.winDrop >= 1 && <span>−{move.winDrop.toFixed(0)}% win</span>}
            {move.timeSpent != null && <span> · {fmtClock(move.timeSpent)} used</span>}
          </span>
          {before.bestMove && (
            <button className="btn ghost sm" onClick={onExplain} disabled={explaining}>💡 Explain</button>
          )}
        </div>
      </div>

      {!playedBest && bestSan && (
        <div className="chess-why">
          <span className="k">Best</span>
          <span><b style={{ color: 'var(--good)' }}>{bestSan}</b>{betterLine ? ` — ${betterLine}` : ''}</span>
        </div>
      )}
      {bad && refutation && (
        <div className="chess-why">
          <span className="k">Punished by</span>
          <span style={{ color: 'var(--muted)' }}>{refutation}</span>
        </div>
      )}
      {playedBest && <div className="chess-why"><span className="k">Engine</span><span style={{ color: 'var(--good)' }}>Top choice.</span></div>}
    </div>
  )
}

function chunkPairs(moves: MoveAnalysis[]): [MoveAnalysis | null, MoveAnalysis | null][] {
  const out: [MoveAnalysis | null, MoveAnalysis | null][] = []
  for (let i = 0; i < moves.length; i += 2) out.push([moves[i] ?? null, moves[i + 1] ?? null])
  return out
}
