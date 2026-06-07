// Topic extraction. After a scrape, posts land with `topics = null`. This tags each post
// (own + inspiration) with a few canonical topic labels in one cheap AI call. Those topics
// drive the Trends widget, sharpen idea generation, and power the Analytics "top topic" insight.

import { createSupabaseServiceClient } from './supabase/server'
import { generate } from './ai/client'

const MAX_POSTS_PER_RUN = 50
const BODY_TRUNC = 240

type Table = 'scraped_posts' | 'inspiration_posts'
interface Item {
  table: Table
  id: string
  body: string
}

export interface ExtractTopicsResult {
  processed: number
  skipped: boolean
  reason?: string
  costUsd?: number
  model?: string
}

const SYSTEM_PROMPT = `You tag LinkedIn posts with topics for a content-trend engine.

For each numbered post, output 1-4 SHORT canonical topic tags. Rules:
- Title Case, 1-3 words each (e.g. "AI Agents", "Startups", "Hiring", "Leadership", "SaaS", "Fundraising", "Personal Branding", "Software Engineering").
- REUSE the same tag across posts that share a theme — consistency matters more than precision, because these tags are aggregated into trends.
- Prefer broad, durable themes over hyper-specific phrases. No hashtags, no punctuation, no emojis.
- If a post is pure fluff with no theme, return an empty array for it.

Return ONLY a JSON array, one object per post, in the same order:
[{"i": 0, "topics": ["AI Agents", "Startups"]}, {"i": 1, "topics": ["Hiring"]}]
No prose, no markdown fences.`

export async function extractTopicsForUser(
  userId: string,
  opts?: { scrapeRunId?: string | null },
): Promise<ExtractTopicsResult> {
  const supabase = createSupabaseServiceClient()

  const [ownRes, inspRes] = await Promise.all([
    supabase
      .from('scraped_posts')
      .select('id, body')
      .eq('user_id', userId)
      .not('body', 'is', null)
      .is('topics', null)
      .limit(MAX_POSTS_PER_RUN),
    supabase
      .from('inspiration_posts')
      .select('id, body')
      .eq('user_id', userId)
      .not('body', 'is', null)
      .is('topics', null)
      .limit(MAX_POSTS_PER_RUN),
  ])

  const items: Item[] = [
    ...((ownRes.data ?? []) as { id: string; body: string }[]).map((r) => ({ table: 'scraped_posts' as Table, id: r.id, body: r.body })),
    ...((inspRes.data ?? []) as { id: string; body: string }[]).map((r) => ({ table: 'inspiration_posts' as Table, id: r.id, body: r.body })),
  ]
    .filter((it) => it.body && it.body.trim().length > 0)
    .slice(0, MAX_POSTS_PER_RUN)

  if (items.length === 0) {
    return { processed: 0, skipped: true, reason: 'No posts need topic tagging.' }
  }

  const userPrompt =
    items.map((it, i) => `Post ${i}: ${truncate(it.body, BODY_TRUNC)}`).join('\n\n') +
    `\n\nReturn a JSON array of ${items.length} objects (one per post, in order), each {"i": <index>, "topics": [...]}.`

  const response = await generate({
    userId,
    task: 'topic_extract',
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: Math.min(4096, 300 + items.length * 40),
    scrapeRunId: opts?.scrapeRunId ?? null,
  })

  const byIndex = parseTopics(response.text)
  if (byIndex.size === 0) {
    console.warn('[topics] unparseable AI response (first 400 chars):', response.text.slice(0, 400))
    return { processed: 0, skipped: false, reason: 'AI returned no parseable topics.', costUsd: response.costUsd, model: response.model }
  }

  // Write topics back. Always set a (possibly empty) array so the post is not re-tagged every run.
  let processed = 0
  await Promise.all(
    items.map(async (it, i) => {
      const topics = normalize(byIndex.get(i) ?? [])
      const { error } = await supabase.from(it.table).update({ topics }).eq('id', it.id).eq('user_id', userId)
      if (!error) processed += 1
    }),
  )

  return { processed, skipped: false, costUsd: response.costUsd, model: response.model }
}

function truncate(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length <= n ? t : t.slice(0, n - 1) + '…'
}

function normalize(topics: unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of topics) {
    if (typeof t !== 'string') continue
    const clean = t.trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 40)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= 4) break
  }
  return out
}

// Tolerant parser. Models return this in many shapes — array of {i, topics}, array of {topics}
// without i (rely on order), array of string-arrays, or an object keyed by index. Handle all.
function parseTopics(text: string): Map<number, unknown[]> {
  const map = new Map<number, unknown[]>()
  const cleaned = stripJsonFence(text).trim()

  let raw: unknown
  try {
    raw = JSON.parse(cleaned)
  } catch {
    // Last resort: grab the first JSON array substring.
    const arrMatch = cleaned.match(/\[[\s\S]*\]/)
    if (!arrMatch) return map
    try {
      raw = JSON.parse(arrMatch[0])
    } catch {
      return map
    }
  }

  // Unwrap a common object wrapper: { posts: [...] } / { results: [...] } / { topics: [...] }.
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    const wrapped = o.posts ?? o.results ?? o.items ?? o.data
    if (Array.isArray(wrapped)) {
      raw = wrapped
    } else {
      // Object keyed by index: { "0": ["AI"], "1": ["Hiring"] } or { "0": {topics:[...]} }.
      for (const [k, v] of Object.entries(o)) {
        const idx = Number(k)
        if (!Number.isInteger(idx)) continue
        map.set(idx, toTopicArray(v))
      }
      return map
    }
  }

  if (!Array.isArray(raw)) return map

  raw.forEach((item, pos) => {
    if (Array.isArray(item)) {
      map.set(pos, item)
      return
    }
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      const iVal = Number(o.i ?? o.index)
      const idx = Number.isInteger(iVal) ? iVal : pos
      map.set(idx, toTopicArray(o.topics ?? o.tags ?? o.labels))
      return
    }
  })
  return map
}

function toTopicArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return v.split(/[,;|]/)
  return []
}

function stripJsonFence(s: string): string {
  const match = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  return match ? match[1] : s
}
