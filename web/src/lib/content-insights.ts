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

type DB = Awaited<ReturnType<typeof createSupabaseServerClient>>

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
  impressions: number
  likes: number
  comments: number
  reposts: number
  media: string | null
}

export interface ContentInsights {
  hasData: boolean
  sampleSize: number
  ownSampleSize: number // how many of the analysed posts are YOUR own (weighted higher)
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
  impressions: number | null // known for YOUR own posts; null for inspiration
  author_person_id: string | null
}

const MIN_SAMPLE = 8

// Comments and reposts are stronger signals than a like, so weight them up.
// When impressions are known (your own posts), use engagement RATE — a post seen by 5,000 with
// 50 likes resonated far less than one seen by 500 with 50 likes. Per-author normalisation
// downstream keeps rate-based (own) and count-based (inspiration) rows comparable.
function engagementScore(r: InsRow): number {
  const eng = (r.likes ?? 0) + 3 * (r.comments ?? 0) + 4 * (r.reposts ?? 0)
  if (r.impressions != null && r.impressions > 0) return eng / r.impressions
  return eng
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

// Accepts an optional client so generation paths (which run under the service client, incl.
// cron/autopilot with no request cookies) can reuse this without an RLS context.
export async function getContentInsights(userId: string, db?: DB): Promise<ContentInsights> {
  const supabase = db ?? (await createSupabaseServerClient())

  // Inspiration corpus (others' posts) — the niche signal, weight 1.
  const { data: inspData } = await supabase
    .from('inspiration_posts')
    .select('body, media, topics, likes, comments, reposts, author_person_id')
    .eq('user_id', userId)
    .order('first_seen_at', { ascending: false })
    .limit(800)
  const inspRows = ((inspData ?? []) as Omit<InsRow, 'impressions'>[])
    .map((r) => ({ ...r, impressions: null }))
    .filter((r) => r.likes != null || r.comments != null || r.reposts != null)

  // YOUR own posts (E2) — ground truth for your audience, weighted higher.
  const ownRows = await loadOwnRows(supabase, userId)

  // Each row carries a weight: own posts count for more so the profile reflects what works
  // for YOUR followers, not just the niche at large.
  const weighted: Array<{ r: InsRow; w: number }> = [
    ...inspRows.map((r) => ({ r, w: 1 })),
    ...ownRows.map((r) => ({ r, w: OWN_WEIGHT })),
  ]

  if (weighted.length < MIN_SAMPLE) {
    return { hasData: false, sampleSize: weighted.length, ownSampleSize: ownRows.length, topTopics: [], formats: [], hookStyles: [], lengthBands: [], topPosts: [] }
  }

  // Per-author baseline (median engagement of that author's captured posts); own posts share
  // the synthetic author key OWN, so they're normalised against your own typical post.
  const byAuthor = new Map<string, number[]>()
  for (const { r } of weighted) {
    const k = r.author_person_id ?? '∅'
    if (!byAuthor.has(k)) byAuthor.set(k, [])
    byAuthor.get(k)!.push(engagementScore(r))
  }
  const globalMedian = Math.max(1, median(weighted.map(({ r }) => engagementScore(r))))
  const authorMedian = new Map<string, number>()
  for (const [k, vals] of byAuthor) authorMedian.set(k, vals.length >= 2 ? Math.max(1, median(vals)) : globalMedian)

  // relScore = how much a post beat its author's typical post (1.0 = typical).
  const rel = weighted.map(({ r, w }) => {
    const base = authorMedian.get(r.author_person_id ?? '∅') ?? globalMedian
    return { r, rel: engagementScore(r) / base, w }
  })
  const totalW = rel.reduce((s, x) => s + x.w, 0) || 1
  const avgRel = rel.reduce((s, x) => s + x.rel * x.w, 0) / totalW || 1

  // Weighted aggregator → Ranked[] sorted by multiplier (relative to corpus average).
  function rankBy<T extends string>(keyOf: (r: InsRow) => T | null, labelOf: (k: T) => string, minPosts = 3): Ranked[] {
    const groups = new Map<T, { sum: number; w: number; n: number }>()
    for (const { r, rel: v, w } of rel) {
      const k = keyOf(r)
      if (k == null) continue
      const g = groups.get(k) ?? { sum: 0, w: 0, n: 0 }
      g.sum += v * w
      g.w += w
      g.n += 1
      groups.set(k, g)
    }
    const out: Ranked[] = []
    for (const [k, g] of groups) {
      if (g.n < minPosts) continue
      out.push({ key: k, label: labelOf(k), multiplier: g.sum / g.w / avgRel, posts: g.n })
    }
    return out.sort((a, b) => b.multiplier - a.multiplier)
  }

  const topTopics = (() => {
    const groups = new Map<string, { sum: number; w: number; n: number }>()
    for (const { r, rel: v, w } of rel) for (const t of r.topics ?? []) {
      const k = t.trim()
      if (!k) continue
      const g = groups.get(k) ?? { sum: 0, w: 0, n: 0 }
      g.sum += v * w
      g.w += w
      g.n += 1
      groups.set(k, g)
    }
    const out: Ranked[] = []
    for (const [k, g] of groups) {
      if (g.n < 3) continue
      out.push({ key: k, label: k, multiplier: g.sum / g.w / avgRel, posts: g.n })
    }
    return out.sort((a, b) => b.multiplier - a.multiplier).slice(0, 8)
  })()

  const formats = rankBy<Format>((r) => (r.media as Format) ?? null, (k) => FORMAT_LABEL[k] ?? k, 3)
  const hookStyles = rankBy<HookStyle>((r) => classifyHook(r.body), (k) => HOOK_LABEL[k], 3)
  const lengthBands = rankBy((r) => lengthBand(r.body).key, (k) => ({ short: 'Short (<300 chars)', medium: 'Medium (300–900)', long: 'Long (900+ chars)' }[k] ?? k), 3)

  const topPosts = [...rel]
    .sort((a, b) => b.rel - a.rel)
    .slice(0, 5)
    .map(({ r }) => ({ body: r.body, impressions: r.impressions ?? 0, likes: r.likes ?? 0, comments: r.comments ?? 0, reposts: r.reposts ?? 0, media: r.media }))

  return { hasData: true, sampleSize: weighted.length, ownSampleSize: ownRows.length, topTopics, formats, hookStyles, lengthBands, topPosts }
}

const OWN_WEIGHT = 3

// Load the user's own posts as InsRow[], using the latest engagement snapshot per post.
async function loadOwnRows(supabase: DB, userId: string): Promise<InsRow[]> {
  const { data: posts } = await supabase
    .from('scraped_posts')
    .select('id, body, media, topics')
    .eq('user_id', userId)
    .limit(300)
  const rows = (posts ?? []) as { id: string; body: string | null; media: string | null; topics: string[] | null }[]
  if (rows.length === 0) return []

  const { data: snaps } = await supabase
    .from('post_metric_snapshots')
    .select('post_id, impressions, likes, comments, reposts, captured_at')
    .in('post_id', rows.map((r) => r.id))
    .order('captured_at', { ascending: false })
  const latest = new Map<string, { impressions: number | null; likes: number | null; comments: number | null; reposts: number | null }>()
  for (const s of (snaps ?? []) as { post_id: string; impressions: number | null; likes: number | null; comments: number | null; reposts: number | null }[]) {
    if (!latest.has(s.post_id)) latest.set(s.post_id, s)
  }

  const out: InsRow[] = []
  for (const r of rows) {
    const m = latest.get(r.id)
    if (!m || (m.likes == null && m.comments == null && m.reposts == null)) continue
    out.push({ body: r.body, media: r.media, topics: r.topics, likes: m.likes, comments: m.comments, reposts: m.reposts, impressions: m.impressions, author_person_id: 'OWN' })
  }
  return out
}

// Compact, prompt-ready summary of what's working — injected into idea & draft generation
// (learning-loop Stage C). Returns null when there isn't enough signal to be trustworthy.
export function performanceProfilePrompt(insights: ContentInsights): string | null {
  if (!insights.hasData) return null
  const winners = (items: Ranked[], n: number) =>
    items.filter((i) => i.multiplier >= 1.1).slice(0, n).map((i) => `${i.label} (${i.multiplier.toFixed(1)}x)`)

  const topics = winners(insights.topTopics, 5)
  const formats = winners(insights.formats, 2)
  const hooks = winners(insights.hookStyles, 2)
  const lengths = winners(insights.lengthBands, 1)
  const lines: string[] = []
  if (topics.length) lines.push(`- Winning topics: ${topics.join(', ')}`)
  if (formats.length) lines.push(`- Winning formats: ${formats.join(', ')}`)
  if (hooks.length) lines.push(`- Winning hooks: ${hooks.join(', ')}`)
  if (lengths.length) lines.push(`- Winning length: ${lengths.join(', ')}`)
  if (lines.length === 0) return null

  const src = insights.ownSampleSize > 0
    ? `learned from ${insights.sampleSize} posts including ${insights.ownSampleSize} of YOUR OWN (your posts weighted higher)`
    : `learned from ${insights.sampleSize} captured feed posts`
  return `WHAT PERFORMS IN THIS NICHE (${src}; engagement normalised per author, so >1.0x means it beats the author's typical post). Lean toward these proven patterns where they genuinely fit the message — never force them or sacrifice the point:\n${lines.join('\n')}`
}
