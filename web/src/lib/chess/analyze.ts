import { Chess } from 'chess.js'
import { ChessEngine, type RawScore } from './engine'

export type Classification = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

export interface WhiteEval {
  cp: number | null // centipawns, White's POV (null when mate is set)
  mate: number | null // moves to mate, White's POV (+ = White mates)
  whiteCp: number // scalar White-POV value used for math (mate mapped to ±BIG)
}

export interface PositionEval extends WhiteEval {
  fen: string
  bestMove: string | null // UCI for the side to move in this position
  pv: string[]
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
  bestSan: string | null // same, in SAN, for display
}

export interface PlayerSummary {
  accuracy: number // 0..100
  best: number
  good: number
  inaccuracy: number
  mistake: number
  blunder: number
}

export interface GameAnalysis {
  fens: string[] // length = moves + 1; fens[0] = start, fens[i] = after ply i
  positions: PositionEval[] // aligned with fens
  moves: MoveAnalysis[]
  white: PlayerSummary
  black: PlayerSummary
  headers: Record<string, string>
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

function classify(winDrop: number, playedBest: boolean): Classification {
  if (playedBest || winDrop < 2) return 'best'
  if (winDrop < 5) return 'good'
  if (winDrop < 10) return 'inaccuracy'
  if (winDrop < 20) return 'mistake'
  return 'blunder'
}

/** Per-move accuracy (lichess formula), from the mover's win% before/after. */
function moveAccuracy(winBefore: number, winAfter: number): number {
  const drop = Math.max(0, winBefore - winAfter)
  const acc = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669
  return Math.max(0, Math.min(100, acc))
}

export interface AnalyzeOptions {
  depth: number
  onProgress?: (done: number, total: number) => void
  signal?: { aborted: boolean }
}

/**
 * Parse a PGN and evaluate every position. Throws on an unparseable PGN.
 * Evaluation is sequential (single engine instance); progress is reported per
 * position so the UI can show a bar.
 */
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
  const positions: PositionEval[] = []

  for (let i = 0; i < fens.length; i++) {
    if (opts.signal?.aborted) throw new Error('aborted')
    const fen = fens[i]
    const sub = new Chess(fen)
    const whiteToMove = fen.split(' ')[1] === 'w'

    if (sub.isGameOver()) {
      // Terminal node — assign a decisive value without bothering the engine.
      let we: WhiteEval
      if (sub.isCheckmate()) {
        // Side to move is mated.
        we = { cp: null, mate: whiteToMove ? -0 : 0, whiteCp: whiteToMove ? -MATE_CP : MATE_CP }
      } else {
        we = { cp: 0, mate: null, whiteCp: 0 } // stalemate / draw
      }
      positions.push({ fen, bestMove: null, pv: [], ...we })
    } else {
      const r = await engine.evaluate(fen, opts.depth)
      const we = toWhiteEval(r.score, whiteToMove)
      positions.push({ fen, bestMove: r.bestMove, pv: r.pv, ...we })
    }
    opts.onProgress?.(i + 1, total)
  }

  // Build per-move analysis from consecutive position evals.
  const moves: MoveAnalysis[] = history.map((h, i) => {
    const before = positions[i]
    const after = positions[i + 1]
    const moverWhite = h.color === 'w'

    const winBeforeWhite = winPercent(before.whiteCp)
    const winAfterWhite = winPercent(after.whiteCp)
    const winBefore = moverWhite ? winBeforeWhite : 100 - winBeforeWhite
    const winAfter = moverWhite ? winAfterWhite : 100 - winAfterWhite
    const winDrop = Math.max(0, winBefore - winAfter)

    const playedBest = !!before.bestMove && before.bestMove === h.lan
    const bestSan = before.bestMove ? uciToSan(before.fen, before.bestMove) : null

    return {
      ply: i + 1,
      moveNumber: Math.floor(i / 2) + 1,
      color: h.color,
      san: h.san,
      lan: h.lan,
      from: h.from,
      to: h.to,
      classification: classify(winDrop, playedBest),
      winDrop,
      bestMove: before.bestMove,
      bestSan,
    }
  })

  const white = summarize(moves.filter((m) => m.color === 'w'), positions, 'w')
  const black = summarize(moves.filter((m) => m.color === 'b'), positions, 'b')

  return { fens, positions, moves, white, black, headers }
}

function summarize(
  moves: MoveAnalysis[],
  positions: PositionEval[],
  color: 'w' | 'b',
): PlayerSummary {
  const counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
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
  return { accuracy, ...counts }
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
