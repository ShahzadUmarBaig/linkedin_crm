// "What's working" analysis (learning-loop Stage B).
//
// Mines the INSPIRATION corpus (others' posts captured from the feed) — useful even with
// zero own posts — to learn which topics, formats, hook styles and lengths earn the most
// engagement. The output (a compact "performance profile") powers the Analytics "what's
// working" panel and, in Stage C, biases idea/draft/visual generation.
//
// Engagement is normalised PER AUTHOR: we can't see follower counts, so a raw like count is
// noisy (a 100k-follower account dwarfs a 2k one). Instead we ask "did this post beat its
// own author's typical post?" — a relative score that makes format/topic signal comparable
// across very different accounts.

import { createSupabaseServerClient } from './supabase/server'

export type HookStyle = 'question' | 'stat' | 'story' | 'bold-claim' | 'list' | 'other'
export type Format = 'text' | 'image' | 'video' | 'article' | 'poll' | 'document'

export interface Ranked {
  key: string
  label: string
  multiplier: number // avg relative-score vs the corpus average (1.0 = average)
  posts: number
}

export interface TopPostExample {
  body: string | null
  likes: number
  comments: number
  reposts: number
  media: string | null
}

export interface ContentInsights {
  hasData: boolean
  sampleSize: number
  topTopics: Ranked[]
  formats: Ranked[]
  hookStyles: Ranked[]
  lengthBands: Ranked[]
  topPosts: TopPostExample[]
}

interface InsRow {
  body: string | null
  media: string | null
  topics: string[] | null
  likes: number | null
  comments: number | null
  reposts: number | null
  author_person_id: string | null
}

const MIN_SAMPLE = 8

// Comments and reposts are stronger signals than a like, so weight them up.
function engagementScore(r: InsRow): number {
  return (r.likes ?? 0) + 3 * (r.comments ?? 0) + 4 * (r.reposts ?? 0)
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function classifyHook(body: string | null): HookStyle {
  if (!body) return 'other'
  const first = body.split('\n')[0].trim()
  const lower = first.toLowerCase()
  if (first.includes('?')) return 'question'
  if (/^\s*[-•]|\n\s*[-•]/.test(body) || /\b\d+\s+(ways|things|lessons|tips|reasons|steps|mistakes)\b/i.test(first)) return 'list'
  if (/^\s*[\d$]/.test(first) || /\b\d+%|\b\d[\d,.]{2,}\b/.test(first)) return 'stat'
  if (/^(i |i'|my |when i|last (week|year|month)|years ago|i remember)/i.test(lower)) return 'story'
  if (first.length > 0 && first.length <= 60) return 'bold-claim'
  return 'other'
}

function lengthBand(body: string | null): { key: string; label: string } {
  const n = body?.length ?? 0
  if (n < 300) return { key: 'short', label: 'Short (<300 chars)' }
  if (n < 900) return { key: 'medium', label: 'Medium (300–900)' }
  return { key: 'long', label: 'Long (900+ chars)' }
}

const FORMAT_LABEL: Record<string, string> = {
  text: 'Text only', image: 'Image', video: 'Video', article: 'Article', poll: 'Poll', document: 'Document/carousel',
}
const HOOK_LABEL: Record<HookStyle, string> = {
  question: 'Opens with a question', stat: 'Opens with a number/stat', story: 'Personal story open',
  'bold-claim': 'Short bold claim', list: 'List / "N things"', other: 'Other',
}

export async function getContentInsights(userId: string): Promise<ContentInsights> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('inspiration_posts')
    .select('body, media, topics, likes, comments, reposts, author_person_id')
    .eq('user_id', userId)
    .order('first_seen_at', { ascending: false })
    .limit(800)

  const rows = ((data ?? []) as InsRow[]).filter(
    (r) => r.likes != null || r.comments != null || r.reposts != null,
  )

  if (rows.length < MIN_SAMPLE) {
    return { hasData: false, sampleSize: rows.length, topTopics: [], formats: [], hookStyles: [], lengthBands: [], topPosts: [] }
  }

  // Per-author baseline (median engagement of that author's captured posts).
  const byAuthor = new Map<string, number[]>()
  for (const r of rows) {
    const k = r.author_person_id ?? '∅'
    if (!byAuthor.has(k)) byAuthor.set(k, [])
    byAuthor.get(k)!.push(engagementScore(r))
  }
  const globalMedian = Math.max(1, median(rows.map(engagementScore)))
  const authorMedian = new Map<string, number>()
  for (const [k, vals] of byAuthor) authorMedian.set(k, vals.length >= 2 ? Math.max(1, median(vals)) : globalMedian)

  // relScore = how much a post beat its author's typical post (1.0 = typical).
  const rel = rows.map((r) => {
    const base = authorMedian.get(r.author_person_id ?? '∅') ?? globalMedian
    return { r, rel: engagementScore(r) / base }
  })
  const avgRel = rel.reduce((s, x) => s + x.rel, 0) / rel.length || 1

  // Generic aggregator → Ranked[] sorted by multiplier (relative to corpus average).
  function rank<T extends string>(
    keyOf: (r: InsRow) => T | null,
    labelOf: (k: T) => string,
    minPosts = 3,
  ): Ranked[] {
    const groups = new Map<T, number[]>()
    for (const { r, rel: v } of rel) {
      const k = keyOf(r)
      if (k == null) continue
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(v)
    }
    const out: Ranked[] = []
    for (const [k, vals] of groups) {
      if (vals.length < minPosts) continue
      const avg = vals.reduce((s, x) => s + x, 0) / vals.length
      out.push({ key: k, label: labelOf(k), multiplier: avg / avgRel, posts: vals.length })
    }
    return out.sort((a, b) => b.multiplier - a.multiplier)
  }

  const topTopics = (() => {
    const groups = new Map<string, number[]>()
    for (const { r, rel: v } of rel) for (const t of r.topics ?? []) {
      const k = t.trim()
      if (!k) continue
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(v)
    }
    const out: Ranked[] = []
    for (const [k, vals] of groups) {
      if (vals.length < 3) continue
      const avg = vals.reduce((s, x) => s + x, 0) / vals.length
      out.push({ key: k, label: k, multiplier: avg / avgRel, posts: vals.length })
    }
    return out.sort((a, b) => b.multiplier - a.multiplier).slice(0, 8)
  })()

  const formats = rank<Format>((r) => (r.media as Format) ?? null, (k) => FORMAT_LABEL[k] ?? k, 3)
  const hookStyles = rank<HookStyle>((r) => classifyHook(r.body), (k) => HOOK_LABEL[k], 3)
  const lengthBands = rank((r) => lengthBand(r.body).key, (k) => ({ short: 'Short (<300 chars)', medium: 'Medium (300–900)', long: 'Long (900+ chars)' }[k] ?? k), 3)

  const topPosts = [...rel]
    .sort((a, b) => b.rel - a.rel)
    .slice(0, 5)
    .map(({ r }) => ({ body: r.body, likes: r.likes ?? 0, comments: r.comments ?? 0, reposts: r.reposts ?? 0, media: r.media }))

  return { hasData: true, sampleSize: rows.length, topTopics, formats, hookStyles, lengthBands, topPosts }
}
