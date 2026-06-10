// Client-side Stockfish wrapper.
//
// Uses the single-threaded "lite" build of Stockfish.js (the engine chess.com
// ships in-browser). Single-threaded => runs as a plain Web Worker with NO
// cross-origin-isolation (COOP/COEP) headers, so it deploys cleanly on Vercel.
// The engine files live in /public/engine and never round-trip to a server —
// your PGN is analysed entirely on your own machine.

const ENGINE_URL = '/engine/stockfish-18-lite-single.js'

export interface RawScore {
  type: 'cp' | 'mate'
  value: number // relative to the side to move
}

export interface EngineLine {
  score: RawScore // relative to the side to move
  pv: string[] // principal variation in UCI
}

export interface EvalResult {
  score: RawScore
  bestMove: string | null // UCI, e.g. "e2e4" or "e7e8q"
  pv: string[] // principal variation in UCI (best line)
  lines: EngineLine[] // top-N lines, index 0 = best (from MultiPV)
  depth: number
}

export class ChessEngine {
  private worker: Worker | null = null
  private ready: Promise<void> | null = null
  private onLine: ((line: string) => void) | null = null

  /** Lazily boot the worker and wait for uciok/readyok. */
  async init(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      try {
        const worker = new Worker(ENGINE_URL)
        this.worker = worker
        worker.onmessage = (e: MessageEvent) => {
          const line = typeof e.data === 'string' ? e.data : String(e.data ?? '')
          this.onLine?.(line)
        }
        worker.onerror = (e) => reject(new Error(`Engine failed to load: ${e.message}`))

        const handshake = (line: string) => {
          if (line.includes('uciok')) this.send('isready')
          else if (line.includes('readyok')) {
            this.onLine = null
            resolve()
          }
        }
        this.onLine = handshake
        // A bit of hash helps; threads stay at 1 (single-threaded build).
        this.send('setoption name Hash value 64')
        this.send('uci')
      } catch (err) {
        reject(err as Error)
      }
    })
    return this.ready
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd)
  }

  private currentMultiPV = 1

  /** Evaluate one position to a fixed depth. Resolves on `bestmove`. */
  async evaluate(fen: string, depth: number, multiPV = 1): Promise<EvalResult> {
    await this.init()
    return new Promise<EvalResult>((resolve) => {
      // collect the latest info line per multipv index
      const byIndex = new Map<number, EngineLine>()
      let reachedDepth = 0

      this.onLine = (line: string) => {
        if (line.startsWith('info')) {
          const scoreMatch = line.match(/score (cp|mate) (-?\d+)/)
          if (!scoreMatch) return
          const idxMatch = line.match(/ multipv (\d+)/)
          const idx = idxMatch ? parseInt(idxMatch[1], 10) : 1
          const depthMatch = line.match(/ depth (\d+)/)
          if (depthMatch) reachedDepth = parseInt(depthMatch[1], 10)
          const pvMatch = line.match(/ pv (.+)$/)
          byIndex.set(idx, {
            score: { type: scoreMatch[1] as 'cp' | 'mate', value: parseInt(scoreMatch[2], 10) },
            pv: pvMatch ? pvMatch[1].trim().split(/\s+/) : [],
          })
        } else if (line.startsWith('bestmove')) {
          this.onLine = null
          const best = line.split(/\s+/)[1]
          const lines = [...byIndex.keys()].sort((a, b) => a - b).map((k) => byIndex.get(k)!)
          const first = lines[0] ?? { score: { type: 'cp' as const, value: 0 }, pv: [] }
          resolve({
            score: first.score,
            bestMove: best && best !== '(none)' ? best : null,
            pv: first.pv,
            lines,
            depth: reachedDepth,
          })
        }
      }

      if (multiPV !== this.currentMultiPV) {
        this.send(`setoption name MultiPV value ${multiPV}`)
        this.currentMultiPV = multiPV
      }
      this.send('ucinewgame')
      this.send(`position fen ${fen}`)
      this.send(`go depth ${depth}`)
    })
  }

  /** Stop any in-flight search and tear down the worker. */
  dispose() {
    if (this.worker) {
      try {
        this.send('quit')
      } catch {
        /* ignore */
      }
      this.worker.terminate()
      this.worker = null
    }
    this.ready = null
    this.onLine = null
  }
}
