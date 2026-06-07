// Performance-driven scheduling. Analyzes the user's own posts + metric snapshots to find the
// best days, times, and topics, then picks the optimal next slot. Until there's enough data we
// fall back to sensible defaults (weekday mornings). All times are computed in UTC.

import { createSupabaseServiceClient } from './supabase/server'

const MIN_POSTS = 8 // below this, "not enough data" → defaults
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DEFAULT_DAYS = [2, 3, 4] // Tue/Wed/Thu
const DEFAULT_HOUR_UTC = 14 // ~9am US-Eastern

export interface DayStat { dow: number; name: string; avg: number; posts: number }
export interface HourStat { hour: number; avg: number; posts: number }
export interface TopicStat { topic: string; avg: number; posts: number; ratio: number }

export interface PostingInsights {
  hasEnoughData: boolean
  sampleSize: number
  metric: 'impressions' | 'engagement'
  bestDays: DayStat[]
  bestHours: HourStat[]
  bestTopics: TopicStat[]
}

type Supa = ReturnType<typeof createSupabaseServiceClient>

export async function getPostingInsights(userId: string): Promise<PostingInsights> {
  const supabase = createSupabaseServiceClient()
  const empty: PostingInsights = {
    hasEnoughData: false,
    sampleSize: 0,
    metric: 'engagement',
    bestDays: [],
    bestHours: [],
    bestTopics: [],
  }

  const { data: posts } = await supabase
    .from('scraped_posts')
    .select('id, posted_at, topics')
    .eq('user_id', userId)
    .not('posted_at', 'is', null)
    .limit(300)
  const postRows = (posts ?? []) as { id: string; posted_at: string; topics: string[] | null }[]
  if (postRows.length === 0) return empty

  const latest = await latestMetricByPost(supabase, postRows.map((p) => p.id))
  if (latest.size === 0) return empty

  // Prefer impressions (reach) when we have any; else fall back to engagement counts.
  const anyImpressions = Array.from(latest.values()).some((m) => m.impressions > 0)
  const metric: PostingInsights['metric'] = anyImpressions ? 'impressions' : 'engagement'
  const score = (m: Metric) => (metric === 'impressions' ? m.impressions : m.likes + m.comments + m.reposts)

  const dayAgg = new Map<number, { sum: number; n: number }>()
  const hourAgg = new Map<number, { sum: number; n: number }>()
  const topicAgg = new Map<string, { sum: number; n: number }>()
  let total = 0
  let sample = 0

  for (const p of postRows) {
    const m = latest.get(p.id)
    if (!m) continue
    const v = score(m)
    const d = new Date(p.posted_at)
    const dow = d.getUTCDay()
    const hour = d.getUTCHours()
    bump(dayAgg, dow, v)
    bump(hourAgg, hour, v)
    for (const raw of p.topics ?? []) {
      const t = raw.trim()
      if (t) bump(topicAgg, t, v)
    }
    total += v
    sample += 1
  }
  if (sample === 0) return empty
  const overall = total / sample

  const bestDays: DayStat[] = Array.from(dayAgg.entries())
    .map(([dow, a]) => ({ dow, name: DAY_NAMES[dow], avg: a.sum / a.n, posts: a.n }))
    .sort((a, b) => b.avg - a.avg)
  const bestHours: HourStat[] = Array.from(hourAgg.entries())
    .map(([hour, a]) => ({ hour, avg: a.sum / a.n, posts: a.n }))
    .sort((a, b) => b.avg - a.avg)
  const bestTopics: TopicStat[] = Array.from(topicAgg.entries())
    .filter(([, a]) => a.n >= 2)
    .map(([topic, a]) => ({ topic, avg: a.sum / a.n, posts: a.n, ratio: overall > 0 ? a.sum / a.n / overall : 1 }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 8)

  return { hasEnoughData: sample >= MIN_POSTS, sampleSize: sample, metric, bestDays, bestHours, bestTopics }
}

export interface OptimalSlot {
  iso: string
  reasoning: string
  dataDriven: boolean
}

// Pick the next optimal slot: a top-performing day at a top-performing hour, at least 24h out,
// not colliding with an existing slot. Falls back to a weekday morning when data is thin.
export async function pickOptimalSlot(
  userId: string,
  opts?: { now?: Date; avoidIsos?: string[] },
): Promise<OptimalSlot> {
  const insights = await getPostingInsights(userId)
  return pickSlotFromInsights(insights, opts)
}

// Pure slot-finder — given already-computed insights. Lets a re-optimize pass place many slots
// without recomputing insights each time.
export function pickSlotFromInsights(insights: PostingInsights, opts?: { now?: Date; avoidIsos?: string[] }): OptimalSlot {
  const now = opts?.now ?? new Date()
  const earliest = now.getTime() + 24 * 3600_000
  const avoid = (opts?.avoidIsos ?? []).map((s) => new Date(s).getTime()).filter((t) => !isNaN(t))
  const collides = (t: number) => avoid.some((a) => Math.abs(a - t) < 20 * 3600_000) // ~same day

  const useData = insights.hasEnoughData
  const days = useData ? new Set(insights.bestDays.slice(0, 3).map((d) => d.dow)) : new Set(DEFAULT_DAYS)
  const hour = useData ? insights.bestHours[0]?.hour ?? DEFAULT_HOUR_UTC : DEFAULT_HOUR_UTC

  for (let i = 1; i <= 28; i++) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() + i)
    d.setUTCHours(hour, 0, 0, 0)
    const t = d.getTime()
    if (t < earliest) continue
    if (!days.has(d.getUTCDay())) continue
    if (collides(t)) continue
    const dayName = DAY_NAMES[d.getUTCDay()]
    const reasoning = useData
      ? `Your posts perform best on ${dayName}s around ${pad(hour)}:00 UTC — auto-scheduled there.`
      : `Default weekday-morning slot (${dayName} ${pad(hour)}:00 UTC). Will optimize once you have more posts.`
    return { iso: d.toISOString(), reasoning, dataDriven: useData }
  }

  // Couldn't place within 4 weeks (heavy collisions) — just go 25h out.
  const d = new Date(earliest + 3600_000)
  return { iso: d.toISOString(), reasoning: 'Next available slot.', dataDriven: false }
}

// Re-pack the upcoming AI-scheduled queue into the current best windows. Runs automatically on
// scrape + nightly, so timing self-corrects as data grows — with zero user action.
// Rules: only touch future, AI-chosen slots > 36h out (don't disturb imminent or manually-pinned
// posts); keep their order; avoid colliding with manual pins.
export async function reoptimizeUpcomingSchedule(userId: string): Promise<{ moved: number }> {
  const supabase = createSupabaseServiceClient()
  const insights = await getPostingInsights(userId)
  const now = new Date()
  const cutoff = now.getTime() + 36 * 3600_000

  const { data: slots } = await supabase
    .from('calendar_slots')
    .select('id, scheduled_for, ai_chosen')
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .gte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true })
  const rows = (slots ?? []) as { id: string; scheduled_for: string; ai_chosen: boolean }[]

  // Manual pins + imminent posts are fixed points we schedule around.
  const fixed = rows.filter((s) => !s.ai_chosen || new Date(s.scheduled_for).getTime() <= cutoff)
  const movable = rows.filter((s) => s.ai_chosen && new Date(s.scheduled_for).getTime() > cutoff)
  if (movable.length === 0) return { moved: 0 }

  const assigned: string[] = fixed.map((s) => s.scheduled_for)
  let cursor = new Date(Math.max(now.getTime(), cutoff))
  let moved = 0

  for (const slot of movable) {
    const opt = pickSlotFromInsights(insights, { now: cursor, avoidIsos: assigned })
    assigned.push(opt.iso)
    cursor = new Date(opt.iso)
    if (opt.iso !== slot.scheduled_for) {
      const { error } = await supabase
        .from('calendar_slots')
        .update({ scheduled_for: opt.iso, ai_reasoning: opt.reasoning })
        .eq('id', slot.id)
        .eq('user_id', userId)
      if (!error) moved += 1
    }
  }
  return { moved }
}

// ---------- helpers ----------

interface Metric { impressions: number; likes: number; comments: number; reposts: number }

async function latestMetricByPost(supabase: Supa, ids: string[]): Promise<Map<string, Metric>> {
  const out = new Map<string, Metric>()
  if (ids.length === 0) return out
  const { data } = await supabase
    .from('post_metric_snapshots')
    .select('post_id, impressions, likes, comments, reposts, captured_at')
    .in('post_id', ids)
    .order('captured_at', { ascending: false })
  for (const s of (data ?? []) as Array<{ post_id: string; impressions: number | null; likes: number | null; comments: number | null; reposts: number | null }>) {
    if (out.has(s.post_id)) continue
    out.set(s.post_id, { impressions: s.impressions ?? 0, likes: s.likes ?? 0, comments: s.comments ?? 0, reposts: s.reposts ?? 0 })
  }
  return out
}

function bump(map: Map<string | number, { sum: number; n: number }>, key: string | number, v: number) {
  const cur = map.get(key) ?? { sum: 0, n: 0 }
  cur.sum += v
  cur.n += 1
  map.set(key, cur)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
