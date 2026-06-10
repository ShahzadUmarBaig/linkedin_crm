import { Chess } from 'chess.js'
import { ChessEngine, type RawScore } from './engine'
import { isBookPosition } from './book'

export type Classification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'

export const CLASS_ORDER: Classification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
]

export interface WhiteEval {
  cp: number | null // centipawns, White's POV (null when mate is set)
  mate: number | null // moves to mate, White's POV (+ = White mates)
  whiteCp: number // scalar White-POV value used for math (mate mapped to ±BIG)
}

export interface PositionEval extends WhiteEval {
  fen: string
  bestMove: string | null // UCI for the side to move in this position
  pv: string[]
  secondWhiteCp: number | null // White-POV scalar of the 2nd-best move (MultiPV), if any
}

export interface MoveAnalysis {
  ply: number // 1-based
  moveNumber: number // full-move number
  color: 'w' | 'b'
  san: string
  lan: string // played move in UCI
  from: string
  to: string
  classification: Classification
  winDrop: number // win% lost by the mover (0..100)
  bestMove: string | null // engine's best in the position BEFORE this move (UCI)
  bestSan: string | null
  clockSeconds: number | null // remaining clock after this move (mover)
  timeSpent: number | null // seconds used on this move
}

export type Counts = Record<Classification, number>

export interface PlayerSummary extends Counts {
  accuracy: number // 0..100
  name: string
  elo: string | null
}

export interface GameAnalysis {
  fens: string[] // length = moves + 1; fens[0] = start, fens[i] = after ply i
  positions: PositionEval[]
  moves: MoveAnalysis[]
  white: PlayerSummary
  black: PlayerSummary
  headers: Record<string, string>
  result: string
  eco: string | null
  termination: string | null
  hasClocks: boolean
}

const MATE_CP = 100000

/** Lichess win-probability model. cp is White's POV. Returns White win% (0..100). */
export function winPercent(whiteCp: number): number {
  const cp = Math.max(-1000, Math.min(1000, whiteCp))
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

function toWhiteEval(score: RawScore, whiteToMove: boolean): WhiteEval {
  const sign = whiteToMove ? 1 : -1
  if (score.type === 'mate') {
    const mate = sign * score.value
    return { cp: null, mate, whiteCp: mate > 0 ? MATE_CP : -MATE_CP }
  }
  const cp = sign * score.value
  return { cp, mate: null, whiteCp: cp }
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

/** Material balance (White − Black) in points from a FEN placement field. */
function materialBalance(fen: string): number {
  let bal = 0
  for (const ch of fen.split(' ')[0]) {
    const v = PIECE_VALUE[ch.toLowerCase()]
    if (v == null) continue
    bal += ch === ch.toUpperCase() ? v : -v
  }
  return bal
}

export interface ClassifyInput {
  winBefore: number // mover POV win% assuming best play (before the move)
  winAfter: number // mover POV win% after the move actually played
  winDrop: number
  playedBest: boolean
  gap: number | null // win% by which best move beats 2nd best (mover POV); null if no 2nd
  sacrifice: boolean // move gives up >= a minor piece of material (net) yet is best
  inBook: boolean
}

function classify(i: ClassifyInput): Classification {
  if (i.inBook) return 'book'
  // Brilliant: a best sacrifice that keeps you at least equal and isn't trivially winning already.
  if (i.playedBest && i.sacrifice && i.winAfter >= 50 && i.winBefore < 99) return 'brilliant'
  // Great: the only good move — clearly better than the second choice.
  if (i.playedBest && i.gap != null && i.gap >= 15 && i.winAfter >= 45) return 'great'
  // Miss: you were better/winning and let a clearly superior resource slip (but not a full collapse).
  if (!i.playedBest && i.winBefore >= 70 && i.winDrop >= 8 && i.winDrop < 25) return 'miss'
  if (i.playedBest || i.winDrop < 1) return 'best'
  if (i.winDrop < 3) return 'excellent'
  if (i.winDrop < 6) return 'good'
  if (i.winDrop < 10) return 'inaccuracy'
  if (i.winDrop < 20) return 'mistake'
  return 'blunder'
}

/** Per-move accuracy (lichess formula), from the mover's win% before/after. */
function moveAccuracy(winBefore: number, winAfter: number): number {
  const drop = Math.max(0, winBefore - winAfter)
  const acc = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669
  return Math.max(0, Math.min(100, acc))
}

function parseClock(s: string): number | null {
  const parts = s.trim().split(':').map(Number)
  if (parts.some(Number.isNaN)) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return null
}

/** Parse "600", "180+2", "300+0" → { base, inc } in seconds. */
function parseTimeControl(tc: string | undefined): { base: number; inc: number } {
  if (!tc) return { base: 0, inc: 0 }
  const m = tc.match(/(\d+)(?:\+(\d+))?/)
  if (!m) return { base: 0, inc: 0 }
  return { base: parseInt(m[1], 10), inc: m[2] ? parseInt(m[2], 10) : 0 }
}

export interface AnalyzeOptions {
  depth: number
  multiPV?: number // top-N lines per position (>=2 enables Great/Brilliant detection)
  onProgress?: (done: number, total: number) => void
  signal?: { aborted: boolean }
}

export async function analyzeGame(
  pgn: string,
  engine: ChessEngine,
  opts: AnalyzeOptions,
): Promise<GameAnalysis> {
  const game = new Chess()
  game.loadPgn(pgn) // throws on invalid PGN
  const history = game.history({ verbose: true })
  if (history.length === 0) throw new Error('No moves found in this PGN.')

  const headers = (game.getHeaders?.() ?? {}) as Record<string, string>
  const fens = [history[0].before, ...history.map((h) => h.after)]
  const total = fens.length

  // ---- clocks (optional, from [%clk] comments) ----
  const { base: initialTime, inc } = parseTimeControl(headers.TimeControl)
  const clockByFen = new Map<string, number>()
  for (const c of game.getComments?.() ?? []) {
    const m = c.comment.match(/\[%clk\s+([0-9:.]+)\]/)
    if (m) {
      const secs = parseClock(m[1])
      if (secs != null) clockByFen.set(c.fen, secs)
    }
  }
  const clockByPly: (number | null)[] = fens.map((f) => clockByFen.get(f) ?? null)
  const hasClocks = clockByPly.some((c, i) => i > 0 && c != null)

  // ---- evaluate every position ----
  const multiPV = Math.max(1, opts.multiPV ?? 2)
  const positions: PositionEval[] = []
  for (let i = 0; i < fens.length; i++) {
    if (opts.signal?.aborted) throw new Error('aborted')
    const fen = fens[i]
    const sub = new Chess(fen)
    const whiteToMove = fen.split(' ')[1] === 'w'

    if (sub.isGameOver()) {
      let we: WhiteEval
      if (sub.isCheckmate()) {
        we = { cp: null, mate: 0, whiteCp: whiteToMove ? -MATE_CP : MATE_CP }
      } else {
        we = { cp: 0, mate: null, whiteCp: 0 }
      }
      positions.push({ fen, bestMove: null, pv: [], secondWhiteCp: null, ...we })
    } else {
      const r = await engine.evaluate(fen, opts.depth, multiPV)
      const we = toWhiteEval(r.score, whiteToMove)
      const second = r.lines[1] ? toWhiteEval(r.lines[1].score, whiteToMove).whiteCp : null
      positions.push({ fen, bestMove: r.bestMove, pv: r.pv, secondWhiteCp: second, ...we })
    }
    opts.onProgress?.(i + 1, total)
  }

  // ---- per-move analysis ----
  const moves: MoveAnalysis[] = history.map((h, i) => {
    const before = positions[i]
    const after = positions[i + 1]
    const moverWhite = h.color === 'w'

    const winBefore = moverWhite ? winPercent(before.whiteCp) : 100 - winPercent(before.whiteCp)
    const winAfter = moverWhite ? winPercent(after.whiteCp) : 100 - winPercent(after.whiteCp)
    const winDrop = Math.max(0, winBefore - winAfter)

    const playedBest = !!before.bestMove && before.bestMove === h.lan
    const bestSan = before.bestMove ? uciToSan(before.fen, before.bestMove) : null

    // gap between best and 2nd-best (mover POV win%) — large gap ⇒ "only move"
    let gap: number | null = null
    if (before.secondWhiteCp != null) {
      const secondWin = moverWhite ? winPercent(before.secondWhiteCp) : 100 - winPercent(before.secondWhiteCp)
      gap = Math.max(0, winBefore - secondWin)
    }

    // sacrifice: after the move + the opponent's best reply, the mover is down
    // ≥ a minor piece of material (i.e. the move gives material away).
    const matBefore = moverWhite ? materialBalance(before.fen) : -materialBalance(before.fen)
    let matAfterReply = moverWhite ? materialBalance(after.fen) : -materialBalance(after.fen)
    if (after.bestMove) {
      const reply = replayUci(after.fen, [after.bestMove])
      if (reply) matAfterReply = moverWhite ? materialBalance(reply) : -materialBalance(reply)
    }
    const sacrifice = matAfterReply - matBefore <= -2

    const inBook = i + 1 <= 20 && isBookPosition(after.fen)

    const ply = i + 1
    const clockSeconds = clockByPly[ply]
    let timeSpent: number | null = null
    if (hasClocks && clockSeconds != null) {
      const prev = ply >= 3 ? clockByPly[ply - 2] : initialTime
      if (prev != null) timeSpent = Math.max(0, prev - clockSeconds + inc)
    }

    return {
      ply,
      moveNumber: Math.floor(i / 2) + 1,
      color: h.color,
      san: h.san,
      lan: h.lan,
      from: h.from,
      to: h.to,
      classification: classify({ winBefore, winAfter, winDrop, playedBest, gap, sacrifice, inBook }),
      winDrop,
      bestMove: before.bestMove,
      bestSan,
      clockSeconds,
      timeSpent,
    }
  })

  const white = summarize(moves.filter((m) => m.color === 'w'), positions, 'w', headers.White || 'White', headers.WhiteElo || null)
  const black = summarize(moves.filter((m) => m.color === 'b'), positions, 'b', headers.Black || 'Black', headers.BlackElo || null)

  return {
    fens,
    positions,
    moves,
    white,
    black,
    headers,
    result: headers.Result || '*',
    eco: headers.ECO && headers.ECO !== '?' ? headers.ECO : null,
    termination: headers.Termination || null,
    hasClocks,
  }
}

function summarize(
  moves: MoveAnalysis[],
  positions: PositionEval[],
  color: 'w' | 'b',
  name: string,
  elo: string | null,
): PlayerSummary {
  const counts: Counts = {
    brilliant: 0, great: 0, best: 0, excellent: 0, good: 0,
    book: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0,
  }
  let accSum = 0
  for (const m of moves) {
    counts[m.classification]++
    const before = positions[m.ply - 1]
    const after = positions[m.ply]
    const moverWhite = color === 'w'
    const wb = moverWhite ? winPercent(before.whiteCp) : 100 - winPercent(before.whiteCp)
    const wa = moverWhite ? winPercent(after.whiteCp) : 100 - winPercent(after.whiteCp)
    accSum += moveAccuracy(wb, wa)
  }
  const accuracy = moves.length ? accSum / moves.length : 100
  return { accuracy, name, elo, ...counts }
}

/** Play a sequence of UCI moves on a FEN; returns the resulting FEN or null. */
function replayUci(fen: string, ucis: string[]): string | null {
  try {
    const c = new Chess(fen)
    for (const u of ucis) {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined })
      if (!m) return null
    }
    return c.fen()
  } catch {
    return null
  }
}

/** Convert a UCI move to SAN in the context of a FEN. */
export function uciToSan(fen: string, uci: string): string | null {
  try {
    const c = new Chess(fen)
    const move = c.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    })
    return move ? move.san : null
  } catch {
    return null
  }
}

/** Format seconds as M:SS (or H:MM:SS). */
export function fmtClock(secs: number | null): string {
  if (secs == null) return '—'
  const s = Math.max(0, Math.round(secs))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}
