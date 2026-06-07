// Read helpers for the Home dashboard + the "trending in your network" widget.
// All reads go through the RLS-scoped server client (runs inside server components).

import { createSupabaseServerClient } from './supabase/server'
import { listIdeas, type IdeaRow } from './ideas'
import { listSlots, type CalendarSlotView } from './calendar'

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
