import type { Classification } from '@/lib/chess/analyze'

export interface ClassMeta {
  label: string
  color: string
  glyph: string // short badge symbol
}

export const CLASS_META: Record<Classification, ClassMeta> = {
  brilliant: { label: 'Brilliant', color: 'oklch(0.74 0.13 195)', glyph: '!!' },
  great: { label: 'Great', color: 'oklch(0.66 0.13 245)', glyph: '!' },
  best: { label: 'Best', color: 'oklch(0.74 0.13 152)', glyph: '★' },
  excellent: { label: 'Excellent', color: 'oklch(0.7 0.12 165)', glyph: '👍' },
  good: { label: 'Good', color: 'oklch(0.72 0.07 200)', glyph: '✓' },
  book: { label: 'Book', color: 'oklch(0.6 0.06 60)', glyph: '📖' },
  inaccuracy: { label: 'Inaccuracy', color: 'oklch(0.82 0.14 90)', glyph: '?!' },
  mistake: { label: 'Mistake', color: 'oklch(0.75 0.15 55)', glyph: '?' },
  miss: { label: 'Miss', color: 'oklch(0.68 0.17 35)', glyph: '✗' },
  blunder: { label: 'Blunder', color: 'oklch(0.62 0.2 25)', glyph: '??' },
}

export function isMistake(c: Classification): boolean {
  return c === 'inaccuracy' || c === 'mistake' || c === 'miss' || c === 'blunder'
}
