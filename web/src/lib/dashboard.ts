// Read helpers for the Home dashboard + the "trending in your network" widget.
// All reads go through the RLS-scoped server client (runs inside server components).

import { createSupabaseServerClient } from './supabase/server'
import { listIdeas, type IdeaRow } from './ideas'
import { listSlots, type CalendarSlotView } from './calendar'
import { getAnalytics } from './analytics'
import { getPostingInsights } from './insights'
import { getContentInsights, type Ranked } from './content-insights'
import { normalizePlaybook } from './playbook'

export interface TrendItem {
  topic: string
  count: number
  weight: number // 0..1 relative to the top trend, for bar widths
}

export interface LastScrape {
  finished_at: string | null
  started_at: string
  posts_captured: number
  inspiration_captured: number
  people_captured: number
  status: string
}

export interface HomeData {
  proposedIdeas: IdeaRow[]
  dueSlots: CalendarSlotView[] // scheduled and the time has arrived — ready to post
  upcomingSlots: CalendarSlotView[] // scheduled, still in the future
  lastScrape: LastScrape | null
  trends: TrendItem[]
  weekScheduled: number
  weekPosted: number
  hasProfile: boolean
}

// Aggregate topic frequency across recently-seen inspiration posts (others' posts
// from the feed). This is the trend signal the idea engine reads.
export async function getTrends(userId: string, limit = 6): Promise<TrendItem[]> {
  const supabase = await createSupabaseServerClient()
  // Trends aggregate topics from both inputs: the LinkedIn feed and RSS/newsletter items.
  const [inspRes, rssRes] = await Promise.all([
    supabase
      .from('inspiration_posts')
      .select('topics')
      .eq('user_id', userId)
      .not('topics', 'is', null)
      .order('first_seen_at', { ascending: false })
      .limit(400),
    supabase
      .from('rss_items')
      .select('topics')
      .eq('user_id', userId)
      .not('topics', 'is', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(400),
  ])

  const counts = new Map<string, number>()
  for (const row of [...((inspRes.data ?? []) as { topics: string[] | null }[]), ...((rssRes.data ?? []) as { topics: string[] | null }[])]) {
    for (const raw of row.topics ?? []) {
      const t = raw.trim()
      if (!t) continue
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }

  const sorted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
  const top = sorted[0]?.[1] ?? 1
  return sorted.map(([topic, count]) => ({ topic, count, weight: count / top }))
}

// ---------------- rich dashboard stats ----------------

export interface DashboardStats {
  // growth & performance
  reachSeries: { label: string; impressions: number; engagement: number }[] // recent posts, chronological
  postedThisWeek: number
  postedPrevWeek: number
  totalImpressions: number
  engagementRatePct: number
  followerCount: number | null
  ownPostCount: number
  bestDay: string | null
  bestHour: number | null
  topPosts: { body: string | null; impressions: number; likes: number; comments: number; reposts: number }[]
  // coaching
  playbook: string | null
  playbookUpdatedAt: string | null
  topTopic: Ranked | null
  topFormat: Ranked | null
  topHook: Ranked | null
  // pipeline
  ideasWaiting: number
  weekScheduled: number
  lastScrape: LastScrape | null
  hasProfile: boolean
  autopilotEnabled: boolean
  lastAutopilotRunAt: string | null
}

export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const supabase = await createSupabaseServerClient()
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const weekAhead = new Date(now + 7 * day).toISOString()
  const weekAgo = new Date(now - 7 * day).toISOString()
  const prevWeekStart = new Date(now - 14 * day).toISOString()
  const since21 = new Date(now - 21 * day).toISOString()

  const [analytics, posting, content, postedSlotsRes, ideasRes, weekSchedRes, lastScrapeRes, profileRes, settingsRes] =
    await Promise.all([
      getAnalytics(userId),
      getPostingInsights(userId),
      getContentInsights(userId),
      supabase
        .from('calendar_slots')
        .select('posted_at')
        .eq('user_id', userId)
        .eq('status', 'posted')
        .gte('posted_at', since21),
      supabase.from('ideas').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'proposed'),
      supabase
        .from('calendar_slots')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'scheduled')
        .gte('scheduled_for', new Date(now).toISOString())
        .lte('scheduled_for', weekAhead),
      supabase
        .from('scrape_runs')
        .select('finished_at, started_at, posts_captured, inspiration_captured, people_captured, status')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // select('*') so this doesn't 500 if the playbook columns (migration 0012) aren't applied yet.
      supabase.from('profile').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('settings').select('autopilot_enabled, last_autopilot_run_at').eq('user_id', userId).maybeSingle(),
    ])

  // Week-over-week posting counts (from posted slots).
  const posted = (postedSlotsRes.data ?? []) as { posted_at: string | null }[]
  let postedThisWeek = 0
  let postedPrevWeek = 0
  for (const p of posted) {
    if (!p.posted_at) continue
    if (p.posted_at >= weekAgo) postedThisWeek++
    else if (p.posted_at >= prevWeekStart) postedPrevWeek++
  }

  // Reach per recent post (chronological) — the actual "am I growing?" signal.
  const eng = (p: { likes: number; comments: number; reposts: number }) => p.likes + p.comments + p.reposts
  const reachSeries = [...analytics.recent]
    .slice(0, 14)
    .reverse()
    .map((p) => ({
      label: p.posted_at ? new Date(p.posted_at).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '',
      impressions: p.impressions,
      engagement: eng(p),
    }))

  // Top posts sorted by engagement (was previously recency order — the bug you spotted).
  const topPosts = (analytics.recent.length
    ? [...analytics.recent].sort((a, b) => eng(b) - eng(a)).slice(0, 5).map((p) => ({ body: p.body, impressions: p.impressions, likes: p.likes, comments: p.comments, reposts: p.reposts }))
    : content.topPosts.slice(0, 5).map((p) => ({ body: p.body, impressions: p.impressions, likes: p.likes, comments: p.comments, reposts: p.reposts })))

  const profile = profileRes.data as { niche: string | null; playbook?: string | null; playbook_updated_at?: string | null } | null
  const settings = settingsRes.data as { autopilot_enabled: boolean | null; last_autopilot_run_at: string | null } | null

  return {
    reachSeries,
    postedThisWeek,
    postedPrevWeek,
    totalImpressions: analytics.totalImpressions,
    engagementRatePct: analytics.engagementRatePct,
    followerCount: analytics.followerCount,
    ownPostCount: analytics.postCount,
    bestDay: posting.bestDays[0]?.name ?? null,
    bestHour: posting.bestHours[0]?.hour ?? null,
    topPosts,
    playbook: profile?.playbook ? normalizePlaybook(profile.playbook) || null : null,
    playbookUpdatedAt: profile?.playbook_updated_at ?? null, // undefined pre-migration → null
    topTopic: content.topTopics[0] ?? null,
    topFormat: content.formats[0] ?? null,
    topHook: content.hookStyles[0] ?? null,
    ideasWaiting: ideasRes.count ?? 0,
    weekScheduled: weekSchedRes.count ?? 0,
    lastScrape: (lastScrapeRes.data as LastScrape | null) ?? null,
    hasProfile: Boolean(profile?.niche),
    autopilotEnabled: Boolean(settings?.autopilot_enabled),
    lastAutopilotRunAt: settings?.last_autopilot_run_at ?? null,
  }
}

export async function getHomeData(userId: string): Promise<HomeData> {
  const supabase = await createSupabaseServerClient()
  const now = Date.now()
  const weekAhead = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString()
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [proposedIdeas, scheduled, trends, lastScrapeRes, weekSchedRes, weekPostedRes, profileRes] =
    await Promise.all([
      listIdeas(userId, 'proposed'),
      listSlots(userId, { status: 'scheduled' }),
      getTrends(userId),
      supabase
        .from('scrape_runs')
        .select('finished_at, started_at, posts_captured, inspiration_captured, people_captured, status')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('calendar_slots')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'scheduled')
        .gte('scheduled_for', new Date(now).toISOString())
        .lte('scheduled_for', weekAhead),
      supabase
        .from('calendar_slots')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'posted')
        .gte('posted_at', weekAgo),
      supabase.from('profile').select('niche').eq('user_id', userId).maybeSingle(),
    ])

  const dueSlots = scheduled.filter((s) => new Date(s.scheduled_for).getTime() <= now)
  const upcomingSlots = scheduled.filter((s) => new Date(s.scheduled_for).getTime() > now).slice(0, 4)

  return {
    proposedIdeas,
    dueSlots,
    upcomingSlots,
    lastScrape: (lastScrapeRes.data as LastScrape | null) ?? null,
    trends,
    weekScheduled: weekSchedRes.count ?? 0,
    weekPosted: weekPostedRes.count ?? 0,
    hasProfile: Boolean((profileRes.data as { niche: string | null } | null)?.niche),
  }
}
