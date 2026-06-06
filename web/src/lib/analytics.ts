// Analytics derived from post_metric_snapshots + scraped_posts.
// V1 aggregates in JS over the latest snapshot per post — single user, small data.

import { createSupabaseServerClient } from './supabase/server'

export interface PostPerformance {
  id: string
  body: string | null
  posted_at: string | null
  topics: string[]
  impressions: number
  likes: number
  comments: number
  reposts: number
}

export interface AnalyticsData {
  totalImpressions: number
  engagementRatePct: number // (likes+comments+reposts)/impressions
  postCount: number
  followerCount: number | null
  recent: PostPerformance[] // newest first, for the table
  last7Impressions: number[] // chronological, oldest→newest, for the bar chart
  topTopic: { topic: string; multiplier: number } | null
  hasData: boolean
}

export async function getAnalytics(userId: string): Promise<AnalyticsData> {
  const supabase = await createSupabaseServerClient()

  const [{ data: posts }, { data: profile }] = await Promise.all([
    supabase
      .from('scraped_posts')
      .select('id, body, posted_at, topics')
      .eq('user_id', userId)
      .order('posted_at', { ascending: false, nullsFirst: false })
      .limit(60),
    supabase.from('profile').select('follower_count').eq('user_id', userId).maybeSingle(),
  ])

  const postRows = (posts ?? []) as { id: string; body: string | null; posted_at: string | null; topics: string[] | null }[]
  if (postRows.length === 0) {
    return {
      totalImpressions: 0,
      engagementRatePct: 0,
      postCount: 0,
      followerCount: (profile as { follower_count: number | null } | null)?.follower_count ?? null,
      recent: [],
      last7Impressions: [],
      topTopic: null,
      hasData: false,
    }
  }

  const ids = postRows.map((p) => p.id)
  const { data: snaps } = await supabase
    .from('post_metric_snapshots')
    .select('post_id, impressions, likes, comments, reposts, captured_at')
    .in('post_id', ids)
    .order('captured_at', { ascending: false })

  // Latest snapshot per post.
  const latest = new Map<string, { impressions: number; likes: number; comments: number; reposts: number }>()
  for (const s of (snaps ?? []) as {
    post_id: string
    impressions: number | null
    likes: number | null
    comments: number | null
    reposts: number | null
  }[]) {
    if (latest.has(s.post_id)) continue
    latest.set(s.post_id, {
      impressions: s.impressions ?? 0,
      likes: s.likes ?? 0,
      comments: s.comments ?? 0,
      reposts: s.reposts ?? 0,
    })
  }

  const recent: PostPerformance[] = postRows.map((p) => {
    const m = latest.get(p.id) ?? { impressions: 0, likes: 0, comments: 0, reposts: 0 }
    return {
      id: p.id,
      body: p.body,
      posted_at: p.posted_at,
      topics: p.topics ?? [],
      ...m,
    }
  })

  const totalImpressions = recent.reduce((a, p) => a + p.impressions, 0)
  const totalEng = recent.reduce((a, p) => a + p.likes + p.comments + p.reposts, 0)
  const engagementRatePct = totalImpressions > 0 ? (totalEng / totalImpressions) * 100 : 0

  // Chart: last 7 posts chronologically (oldest→newest), impressions.
  const chrono = [...recent].filter((p) => p.posted_at).reverse()
  const last7Impressions = chrono.slice(-7).map((p) => p.impressions)

  // Top topic by avg impressions vs overall avg.
  const avgImpr = recent.length ? totalImpressions / recent.length : 0
  const byTopic = new Map<string, { sum: number; n: number }>()
  for (const p of recent) {
    for (const t of p.topics) {
      const cur = byTopic.get(t) ?? { sum: 0, n: 0 }
      cur.sum += p.impressions
      cur.n += 1
      byTopic.set(t, cur)
    }
  }
  let topTopic: AnalyticsData['topTopic'] = null
  if (avgImpr > 0) {
    for (const [topic, { sum, n }] of byTopic) {
      if (n < 1) continue
      const mult = sum / n / avgImpr
      if (mult > (topTopic?.multiplier ?? 1.2)) topTopic = { topic, multiplier: mult }
    }
  }

  return {
    totalImpressions,
    engagementRatePct,
    postCount: recent.length,
    followerCount: (profile as { follower_count: number | null } | null)?.follower_count ?? null,
    recent: recent.slice(0, 12),
    last7Impressions,
    topTopic,
    hasData: snaps != null && snaps.length > 0,
  }
}
