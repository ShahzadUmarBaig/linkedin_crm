// Signals screen: the raw inputs the engine reads. A full explorer over everything the
// extension has captured — your posts, feed (inspiration) posts, people, and engagements —
// plus scrape stats and detected trends.

import { createSupabaseServerClient } from './supabase/server'
import { getTrends, type TrendItem } from './dashboard'

export interface SignalPost {
  id: string
  url: string | null
  body: string | null
  media: string | null
  topics: string[]
  posted_at: string | null
  images: string[]
  impressions: number | null
  likes: number | null
  comments: number | null
  reposts: number | null
  author?: string | null // inspiration posts only
}

export interface SignalPerson {
  id: string
  full_name: string | null
  headline: string | null
  company: string | null
  location: string | null
  follower_count: number | null
  connection_count: number | null
  top_skills: string[]
  is_connection: boolean
  profile_url: string | null
}

export interface SignalEngagement {
  id: string
  type: string
  reaction: string | null
  comment_text: string | null
  engaged_at: string | null
  person_name: string | null
  post_body: string | null
}

export interface SignalsData {
  feedScanned: number
  ownPostsTracked: number
  peopleCount: number
  engagementsCount: number
  trendsDetected: number
  lastSyncedAt: string | null
  trends: TrendItem[]
  ownPosts: SignalPost[]
  inspiration: SignalPost[]
  people: SignalPerson[]
  engagements: SignalEngagement[]
}

function imagesFromRaw(raw: unknown): string[] {
  if (raw && typeof raw === 'object' && Array.isArray((raw as { images?: unknown }).images)) {
    return ((raw as { images: unknown[] }).images).filter((u): u is string => typeof u === 'string')
  }
  return []
}

export async function getSignals(userId: string): Promise<SignalsData> {
  const supabase = await createSupabaseServerClient()

  const [
    trends,
    feedCountRes,
    ownCountRes,
    peopleCountRes,
    engCountRes,
    lastScrapeRes,
    ownPostsRes,
    inspirationRes,
    peopleRes,
    engagementsRes,
  ] = await Promise.all([
    getTrends(userId, 12),
    supabase.from('inspiration_posts').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('scraped_posts').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('people').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('engagements').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase
      .from('scrape_runs')
      .select('finished_at, started_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('scraped_posts')
      .select('id, url, body, media, topics, posted_at, raw')
      .eq('user_id', userId)
      .order('posted_at', { ascending: false, nullsFirst: false })
      .limit(100),
    supabase
      .from('inspiration_posts')
      .select('id, url, body, media, topics, posted_at, likes, comments, reposts, raw, people:author_person_id ( full_name )')
      .eq('user_id', userId)
      .order('first_seen_at', { ascending: false })
      .limit(100),
    supabase
      .from('people')
      .select('id, full_name, headline, company, location, follower_count, connection_count, top_skills, is_connection, profile_url')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(200),
    supabase
      .from('engagements')
      .select('id, type, reaction, comment_text, engaged_at, people:person_id ( full_name ), scraped_posts:post_id ( body )')
      .eq('user_id', userId)
      .order('engaged_at', { ascending: false, nullsFirst: false })
      .limit(200),
  ])

  // Latest metric snapshot per own post.
  const ownRows = (ownPostsRes.data ?? []) as {
    id: string; url: string | null; body: string | null; media: string | null
    topics: string[] | null; posted_at: string | null; raw: unknown
  }[]
  const latestMetrics = new Map<string, { impressions: number | null; likes: number | null; comments: number | null; reposts: number | null }>()
  if (ownRows.length > 0) {
    const { data: snaps } = await supabase
      .from('post_metric_snapshots')
      .select('post_id, impressions, likes, comments, reposts, captured_at')
      .in('post_id', ownRows.map((p) => p.id))
      .order('captured_at', { ascending: false })
    for (const s of (snaps ?? []) as { post_id: string; impressions: number | null; likes: number | null; comments: number | null; reposts: number | null }[]) {
      if (!latestMetrics.has(s.post_id)) {
        latestMetrics.set(s.post_id, { impressions: s.impressions, likes: s.likes, comments: s.comments, reposts: s.reposts })
      }
    }
  }

  const ownPosts: SignalPost[] = ownRows.map((p) => {
    const m = latestMetrics.get(p.id)
    return {
      id: p.id, url: p.url, body: p.body, media: p.media, topics: p.topics ?? [],
      posted_at: p.posted_at, images: imagesFromRaw(p.raw),
      impressions: m?.impressions ?? null, likes: m?.likes ?? null, comments: m?.comments ?? null, reposts: m?.reposts ?? null,
    }
  })

  type InspRow = {
    id: string; url: string | null; body: string | null; media: string | null; topics: string[] | null
    posted_at: string | null; likes: number | null; comments: number | null; reposts: number | null; raw: unknown
    people: { full_name: string | null } | { full_name: string | null }[] | null
  }
  const inspiration: SignalPost[] = ((inspirationRes.data as InspRow[] | null) ?? []).map((p) => {
    const person = Array.isArray(p.people) ? p.people[0] : p.people
    return {
      id: p.id, url: p.url, body: p.body, media: p.media, topics: p.topics ?? [],
      posted_at: p.posted_at, images: imagesFromRaw(p.raw),
      impressions: null, likes: p.likes, comments: p.comments, reposts: p.reposts,
      author: person?.full_name ?? null,
    }
  })

  const people: SignalPerson[] = ((peopleRes.data as SignalPerson[] | null) ?? []).map((p) => ({
    ...p,
    top_skills: (p.top_skills as unknown as string[] | null) ?? [],
  }))

  type EngRow = {
    id: string; type: string; reaction: string | null; comment_text: string | null; engaged_at: string | null
    people: { full_name: string | null } | { full_name: string | null }[] | null
    scraped_posts: { body: string | null } | { body: string | null }[] | null
  }
  const engagements: SignalEngagement[] = ((engagementsRes.data as EngRow[] | null) ?? []).map((e) => {
    const person = Array.isArray(e.people) ? e.people[0] : e.people
    const post = Array.isArray(e.scraped_posts) ? e.scraped_posts[0] : e.scraped_posts
    return {
      id: e.id, type: e.type, reaction: e.reaction, comment_text: e.comment_text, engaged_at: e.engaged_at,
      person_name: person?.full_name ?? null, post_body: post?.body ?? null,
    }
  })

  const last = lastScrapeRes.data as { finished_at: string | null; started_at: string } | null

  return {
    feedScanned: feedCountRes.count ?? 0,
    ownPostsTracked: ownCountRes.count ?? 0,
    peopleCount: peopleCountRes.count ?? 0,
    engagementsCount: engCountRes.count ?? 0,
    trendsDetected: trends.length,
    lastSyncedAt: last?.finished_at ?? last?.started_at ?? null,
    trends,
    ownPosts,
    inspiration,
    people,
    engagements,
  }
}
