import { Chess } from 'chess.js'

// A small, hand-picked opening book. Not exhaustive (chess.com uses a huge DB) —
// it covers the common mainlines so early theory gets a "Book" label. Each entry
// is a sequence of SAN moves; every resulting position is treated as "in book".
const LINES: string[] = [
  // 1.e4 e5
  'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O', // Ruy Lopez
  'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6', // Italian
  'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5', // Two Knights
  'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6', // Scotch
  'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4', // Petrov
  'e4 e5 Bc4 Nf6 d3 c6', // Bishop's
  'e4 e5 Nc3 Nf6', // Vienna
  // 1.e4 c5 Sicilian
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', // Najdorf
  'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5', // Sveshnikov
  'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nf6 Nc3 d6', // Scheveningen
  'e4 c5 Nc3 Nc6 g3', // Closed Sicilian
  // 1.e4 others
  'e4 e6 d4 d5 Nc3 Bb4', // French Winawer
  'e4 e6 d4 d5 Nd2 Nf6', // French Tarrasch
  'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5', // Caro-Kann
  'e4 d5 exd5 Qxd5 Nc3 Qa5', // Scandinavian
  'e4 d6 d4 Nf6 Nc3 g6', // Pirc
  'e4 g6 d4 Bg7 Nc3 d6', // Modern
  // 1.d4 d5
  'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7', // QGD
  'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4', // Slav
  'd4 d5 c4 dxc4 Nf3 Nf6 e3 e6', // QGA
  'd4 d5 Nf3 Nf6 e3', // London-ish
  // 1.d4 Nf6
  'd4 Nf6 c4 e6 Nc3 Bb4', // Nimzo-Indian
  'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6', // King's Indian
  'd4 Nf6 c4 g6 Nc3 d5', // Grünfeld
  'd4 Nf6 c4 e6 Nf3 b6', // Queen's Indian
  'd4 f5 g3 Nf6 Bg2', // Dutch
  // Flank / others
  'c4 e5 Nc3 Nf6 Nf3 Nc6', // English
  'c4 Nf6 Nc3 e6 Nf3', // English
  'Nf3 d5 g3 Nf6 Bg2', // Réti / KIA
  'Nf3 Nf6 c4 g6', // Indian
  'g3 d5 Bg2 Nf6', // KIA
  'b3 e5 Bb2 Nc6', // Larsen / Nimzo-Larsen
  'd3 e5 Nd2 d5', // tiny offbeat openings so very early moves still read as book
  'e3 d5 d4',
  'c3 d5 d4',
]

let bookSet: Set<string> | null = null

function posKey(fen: string): string {
  // piece placement + side to move (ignore clocks/castling/ep for fuzzy matching)
  const parts = fen.split(' ')
  return `${parts[0]} ${parts[1]}`
}

function buildBook(): Set<string> {
  const set = new Set<string>()
  for (const line of LINES) {
    const c = new Chess()
    for (const san of line.split(/\s+/)) {
      try {
        const m = c.move(san)
        if (!m) break
        set.add(posKey(c.fen()))
      } catch {
        break
      }
    }
  }
  return set
}

/** Is this position part of known opening theory in our small book? */
export function isBookPosition(fen: string): boolean {
  if (!bookSet) bookSet = buildBook()
  return bookSet.has(posKey(fen))
}
