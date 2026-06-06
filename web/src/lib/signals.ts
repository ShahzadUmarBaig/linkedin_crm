// Signals screen: the raw inputs the engine reads — scrape stats, detected trends,
// and a sample of recently-captured feed posts.

import { createSupabaseServerClient } from './supabase/server'
import { getTrends, type TrendItem } from './dashboard'

export interface FeedSampleItem {
  id: string
  author: string | null
  body: string | null
  topics: string[]
  likes: number | null
  comments: number | null
  posted_at: string | null
}

export interface SignalsData {
  feedScanned: number
  ownPostsTracked: number
  trendsDetected: number
  lastSyncedAt: string | null
  trends: TrendItem[]
  feedSample: FeedSampleItem[]
}

export async function getSignals(userId: string): Promise<SignalsData> {
  const supabase = await createSupabaseServerClient()

  const [trends, feedCountRes, ownCountRes, lastScrapeRes, sampleRes] = await Promise.all([
    getTrends(userId, 8),
    supabase.from('inspiration_posts').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('scraped_posts').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase
      .from('scrape_runs')
      .select('finished_at, started_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('inspiration_posts')
      .select('id, body, topics, likes, comments, posted_at, people:author_person_id ( full_name )')
      .eq('user_id', userId)
      .order('first_seen_at', { ascending: false })
      .limit(8),
  ])

  type SampleRow = {
    id: string
    body: string | null
    topics: string[] | null
    likes: number | null
    comments: number | null
    posted_at: string | null
    people: { full_name: string | null } | { full_name: string | null }[] | null
  }

  const feedSample: FeedSampleItem[] = ((sampleRes.data as SampleRow[] | null) ?? []).map((r) => {
    const person = Array.isArray(r.people) ? r.people[0] : r.people
    return {
      id: r.id,
      author: person?.full_name ?? null,
      body: r.body,
      topics: r.topics ?? [],
      likes: r.likes,
      comments: r.comments,
      posted_at: r.posted_at,
    }
  })

  const last = lastScrapeRes.data as { finished_at: string | null; started_at: string } | null

  return {
    feedScanned: feedCountRes.count ?? 0,
    ownPostsTracked: ownCountRes.count ?? 0,
    trendsDetected: trends.length,
    lastSyncedAt: last?.finished_at ?? last?.started_at ?? null,
    trends,
    feedSample,
  }
}
