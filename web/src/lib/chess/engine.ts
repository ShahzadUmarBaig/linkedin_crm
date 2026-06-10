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

export interface EvalResult {
  score: RawScore
  bestMove: string | null // UCI, e.g. "e2e4" or "e7e8q"
  pv: string[] // principal variation in UCI
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

  /** Evaluate one position to a fixed depth. Resolves on `bestmove`. */
  async evaluate(fen: string, depth: number): Promise<EvalResult> {
    await this.init()
    return new Promise<EvalResult>((resolve) => {
      let score: RawScore = { type: 'cp', value: 0 }
      let pv: string[] = []
      let reachedDepth = 0

      this.onLine = (line: string) => {
        if (line.startsWith('info')) {
          const scoreMatch = line.match(/score (cp|mate) (-?\d+)/)
          if (scoreMatch) {
            score = { type: scoreMatch[1] as 'cp' | 'mate', value: parseInt(scoreMatch[2], 10) }
          }
          const depthMatch = line.match(/ depth (\d+)/)
          if (depthMatch) reachedDepth = parseInt(depthMatch[1], 10)
          const pvMatch = line.match(/ pv (.+)$/)
          if (pvMatch) pv = pvMatch[1].trim().split(/\s+/)
        } else if (line.startsWith('bestmove')) {
          this.onLine = null
          const best = line.split(/\s+/)[1]
          resolve({
            score,
            bestMove: best && best !== '(none)' ? best : null,
            pv,
            depth: reachedDepth,
          })
        }
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
