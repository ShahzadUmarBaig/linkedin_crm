// RSS / newsletter ingestion. Users add feed URLs; we fetch + parse items and store them as a
// second input source. Items flow into topic extraction → trends and into idea generation.

import Parser from 'rss-parser'
import { createSupabaseServiceClient } from './supabase/server'

const parser: Parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'LinkedInCRM/1.0 (+https://github.com)' },
})

const MAX_ITEMS_PER_FETCH = 30

export interface RssFeed {
  id: string
  url: string
  title: string | null
  active: boolean
  last_fetched_at: string | null
  last_error: string | null
  item_count?: number
}

export interface RssItem {
  id: string
  feed_id: string
  title: string | null
  url: string | null
  author: string | null
  summary: string | null
  content: string | null
  published_at: string | null
  topics: string[]
  feed_title?: string | null
}

export interface RssData {
  feeds: RssFeed[]
  items: RssItem[]
}

// ---------- feed CRUD ----------

export async function listFeeds(userId: string): Promise<RssFeed[]> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('rss_feeds')
    .select('id, url, title, active, last_fetched_at, last_error')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listFeeds: ${error.message}`)
  return (data ?? []) as RssFeed[]
}

export async function addFeed(userId: string, rawUrl: string): Promise<{ feed: RssFeed; itemsAdded: number }> {
  const url = normalizeUrl(rawUrl)
  if (!url) throw new Error('Enter a valid http(s) feed URL.')

  // Validate by parsing once; also grab the feed title.
  let parsed: Parser.Output<Record<string, unknown>>
  try {
    parsed = await parser.parseURL(url)
  } catch (err) {
    throw new Error(`Could not read that feed: ${err instanceof Error ? err.message : 'fetch failed'}`)
  }

  const supabase = createSupabaseServiceClient()
  const { data: feed, error } = await supabase
    .from('rss_feeds')
    .upsert(
      { user_id: userId, url, title: parsed.title ?? hostOf(url), active: true },
      { onConflict: 'user_id,url' },
    )
    .select('id, url, title, active, last_fetched_at, last_error')
    .single()
  if (error || !feed) throw new Error(`addFeed: ${error?.message}`)

  const itemsAdded = await storeItems(userId, feed.id, parsed)
  await supabase.from('rss_feeds').update({ last_fetched_at: new Date().toISOString(), last_error: null }).eq('id', feed.id)

  return { feed: feed as RssFeed, itemsAdded }
}

export async function removeFeed(userId: string, feedId: string): Promise<void> {
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('rss_feeds').delete().eq('id', feedId).eq('user_id', userId)
  if (error) throw new Error(`removeFeed: ${error.message}`)
}

// ---------- fetching ----------

export async function refreshAllFeedsForUser(userId: string): Promise<{ feedsFetched: number; itemsAdded: number }> {
  const supabase = createSupabaseServiceClient()
  const { data: feeds } = await supabase
    .from('rss_feeds')
    .select('id, url')
    .eq('user_id', userId)
    .eq('active', true)

  let itemsAdded = 0
  let feedsFetched = 0
  for (const f of (feeds ?? []) as { id: string; url: string }[]) {
    try {
      const parsed = await parser.parseURL(f.url)
      itemsAdded += await storeItems(userId, f.id, parsed)
      await supabase.from('rss_feeds').update({ last_fetched_at: new Date().toISOString(), last_error: null }).eq('id', f.id)
      feedsFetched += 1
    } catch (err) {
      await supabase
        .from('rss_feeds')
        .update({ last_fetched_at: new Date().toISOString(), last_error: err instanceof Error ? err.message.slice(0, 300) : 'fetch failed' })
        .eq('id', f.id)
    }
  }
  return { feedsFetched, itemsAdded }
}

async function storeItems(
  userId: string,
  feedId: string,
  parsed: Parser.Output<Record<string, unknown>>,
): Promise<number> {
  const items = (parsed.items ?? []).slice(0, MAX_ITEMS_PER_FETCH)
  if (items.length === 0) return 0

  const rows = items.map((it) => {
    const content = (it['content:encoded'] as string | undefined) ?? it.content ?? null
    return {
      user_id: userId,
      feed_id: feedId,
      guid: String(it.guid ?? it.id ?? it.link ?? `${feedId}:${it.title ?? Math.random()}`).slice(0, 500),
      url: it.link ?? null,
      title: it.title ?? null,
      author: (it.creator as string | undefined) ?? (it.author as string | undefined) ?? null,
      content: content ? stripHtml(content).slice(0, 8000) : null,
      summary: it.contentSnippet ? it.contentSnippet.slice(0, 1000) : (content ? stripHtml(content).slice(0, 1000) : null),
      published_at: toIso(it.isoDate ?? it.pubDate),
      raw: { creator: it.creator ?? null, categories: it.categories ?? null },
    }
  })

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('rss_items')
    .upsert(rows, { onConflict: 'user_id,guid', ignoreDuplicates: true })
    .select('id')
  if (error) throw new Error(`storeItems: ${error.message}`)
  return data?.length ?? 0
}

// ---------- reads ----------

export async function getRssData(userId: string): Promise<RssData> {
  const supabase = createSupabaseServiceClient()
  const [{ data: feeds }, { data: items }] = await Promise.all([
    supabase
      .from('rss_feeds')
      .select('id, url, title, active, last_fetched_at, last_error')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('rss_items')
      .select('id, feed_id, title, url, author, summary, content, published_at, topics, rss_feeds:feed_id ( title )')
      .eq('user_id', userId)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(60),
  ])

  type ItemRow = Omit<RssItem, 'topics' | 'feed_title'> & {
    topics: string[] | null
    rss_feeds: { title: string | null } | { title: string | null }[] | null
  }

  const mappedItems: RssItem[] = ((items as ItemRow[] | null) ?? []).map((r) => {
    const feed = Array.isArray(r.rss_feeds) ? r.rss_feeds[0] : r.rss_feeds
    return { ...r, topics: r.topics ?? [], feed_title: feed?.title ?? null }
  })

  // Per-feed item counts.
  const counts = new Map<string, number>()
  for (const it of mappedItems) counts.set(it.feed_id, (counts.get(it.feed_id) ?? 0) + 1)

  const mappedFeeds: RssFeed[] = ((feeds ?? []) as RssFeed[]).map((f) => ({ ...f, item_count: counts.get(f.id) ?? 0 }))

  return { feeds: mappedFeeds, items: mappedItems }
}

// Recent newsletter items as source material for idea generation.
export async function getRecentRssForIdeas(
  userId: string,
  limit = 12,
): Promise<Array<{ title: string | null; summary: string | null }>> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('rss_items')
    .select('title, summary')
    .eq('user_id', userId)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  return ((data ?? []) as { title: string | null; summary: string | null }[]).filter((r) => r.title || r.summary)
}

// ---------- helpers ----------

function normalizeUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function toIso(d: string | undefined): string | null {
  if (!d) return null
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? null : dt.toISOString()
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}
