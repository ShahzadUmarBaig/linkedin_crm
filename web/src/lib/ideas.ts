// Idea generation + lifecycle helpers.
// Ideas are speculative + cheap. Drafts are committed + expensive. This split keeps token
// spend bounded: we only ever have ~5 ideas in queue, and a draft is generated only after
// the user explicitly approves an idea.

import { createSupabaseServerClient, createSupabaseServiceClient } from './supabase/server'
import { generate } from './ai/client'
import { getRecentRssForIdeas } from './rss'

export const IDEA_QUEUE_TARGET = 5

type Supa = ReturnType<typeof createSupabaseServiceClient>

export type IdeaStatus = 'proposed' | 'selected' | 'rejected' | 'scheduled' | 'posted'

export interface IdeaRow {
  id: string
  status: IdeaStatus
  hook: string | null
  angle: string | null
  pillar: string | null
  score: number | null
  topics: string[] | null
  source_type: string | null
  source_inspiration_post_id: string | null
  source_scraped_post_id: string | null
  ai_run_id: string | null
  generated_at: string
  selected_at: string | null
  rejected_at: string | null
}

export async function listIdeas(userId: string, status?: IdeaStatus): Promise<IdeaRow[]> {
  const supabase = await createSupabaseServerClient()
  let q = supabase.from('ideas').select('*').eq('user_id', userId).order('generated_at', { ascending: false })
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw new Error(`listIdeas failed: ${error.message}`)
  return (data ?? []) as IdeaRow[]
}

export async function updateIdeaFields(userId: string, ideaId: string, patch: Partial<Pick<IdeaRow, 'hook' | 'angle' | 'pillar'>>): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('ideas').update(patch).eq('id', ideaId).eq('user_id', userId)
  if (error) throw new Error(`updateIdea failed: ${error.message}`)
}

export async function rejectIdea(userId: string, ideaId: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('ideas')
    .update({ status: 'rejected', rejected_at: new Date().toISOString() })
    .eq('id', ideaId)
    .eq('user_id', userId)
  if (error) throw new Error(`rejectIdea failed: ${error.message}`)
}

// ----- Generation -----

const SYSTEM_PROMPT = `You generate LinkedIn post IDEAS — not full posts. Each idea is a seed
the user will later expand into a draft.

You are given THREE input sources: the user's OWN past posts, posts from their FEED (others),
and recent NEWSLETTER/blog items. Draw ideas from a BALANCED MIX of all three.

Return ONLY a JSON array of ideas (no prose, no markdown fences). Each idea object:
{
  "hook":   "the very first line of a hypothetical LinkedIn post — punchy, specific, curiosity- or emotion-driven. <= 120 chars.",
  "angle":  "one sentence on what the post would actually say — the unique take, not the topic.",
  "pillar": "exactly one of the user's pillars (must match by name)",
  "topics": ["1-3 short Title-Case topic tags, e.g. \\"AI Agents\\", \\"Startups\\" — reuse common tags"],
  "source_type": "own_post_pattern" | "inspiration_post" | "rss_item" | "niche_research",
  "base_score": 0-100 integer — your honest read on this hook's stop-scroll power + comment potential for THIS user's audience. Be discriminating: reserve 80+ for genuinely strong, specific, contrarian or story-driven hooks; give generic/safe ones 40-60.,
  "source_inspiration_urn": "the urn of the feed post that sparked this, if source_type is inspiration_post (else null)",
  "source_scraped_urn":     "the urn of the user's own past post being riffed on, if source_type is own_post_pattern (else null)"
}

Rules:
- BALANCE across sources: across the set, include ideas grounded in own_post_pattern, inspiration_post, AND rss_item — do not take them all from one source. Use niche_research only to fill gaps.
- Hooks must be distinct from each other AND from the existing-hooks list provided.
- Use the user's tone exactly. If they sound casual, your hooks sound casual; if professional, professional.
- A hook is NOT a question unless the question is provocative or contrarian.
- If you cite a source, the angle must be a contrarian, additive, or deeper take — never a copy.
- Output a single JSON array. No commentary.`

type ParsedSourceType = 'inspiration_post' | 'own_post_pattern' | 'rss_item' | 'niche_research'

interface ParsedIdea {
  hook: string
  angle: string
  pillar: string
  topics: string[]
  baseScore: number
  sourceType: ParsedSourceType
  sourceInspirationUrn: string | null
  sourceScrapedUrn: string | null
}

export interface GenerateIdeasResult {
  generated: number
  skipped: boolean
  reason?: string
  costUsd?: number
  model?: string
}

export async function generateIdeas(
  userId: string,
  opts?: { force?: boolean; scrapeRunId?: string | null },
): Promise<GenerateIdeasResult> {
  const supabase = createSupabaseServiceClient()

  // 1. Profile must exist with at least a niche + pillars
  const { data: profile } = await supabase.from('profile').select('*').eq('user_id', userId).maybeSingle()
  if (!profile?.niche) {
    return { generated: 0, skipped: true, reason: 'Profile not set — visit /profile and run AI inference first.' }
  }
  const pillars = ((profile.pillars ?? []) as Array<{ name: string; description: string }>).filter((p) => p.name)
  if (pillars.length === 0) {
    return { generated: 0, skipped: true, reason: 'Profile has no pillars set.' }
  }

  // 2. Throttle by queue size
  const { count: existingCount, error: countErr } = await supabase
    .from('ideas')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'proposed')
  if (countErr) throw new Error(`count proposed ideas: ${countErr.message}`)
  const proposed = existingCount ?? 0
  const target = opts?.force ? IDEA_QUEUE_TARGET : Math.max(0, IDEA_QUEUE_TARGET - proposed)
  if (target === 0) {
    return { generated: 0, skipped: true, reason: `Queue already has ${proposed} proposed ideas (target ${IDEA_QUEUE_TARGET}).` }
  }

  // 3. Gather context: recent own posts + recent inspiration + recent newsletter items
  const [{ data: ownPosts }, { data: inspirations }, { data: existingIdeas }, rssItems] = await Promise.all([
    supabase
      .from('scraped_posts')
      .select('linkedin_urn, body, posted_at')
      .eq('user_id', userId)
      .not('body', 'is', null)
      .order('posted_at', { ascending: false, nullsFirst: false })
      .limit(15),
    supabase
      .from('inspiration_posts')
      .select('linkedin_urn, body, likes, comments, posted_at')
      .eq('user_id', userId)
      .not('body', 'is', null)
      .order('first_seen_at', { ascending: false })
      .limit(15),
    supabase
      .from('ideas')
      .select('hook')
      .eq('user_id', userId)
      .eq('status', 'proposed')
      .limit(20),
    getRecentRssForIdeas(userId, 12),
  ])

  // 4. Build prompts + call AI
  const userPrompt = buildUserPrompt({
    profile: profile as { niche: string; audience: string | null; tone: string | null; pillars: Array<{ name: string; description: string }> },
    pillars,
    ownPosts: ownPosts ?? [],
    inspirations: inspirations ?? [],
    rssItems: rssItems ?? [],
    existingHooks: (existingIdeas ?? []).map((i: { hook: string | null }) => i.hook).filter((h): h is string => Boolean(h)),
    count: target,
  })

  const response = await generate({
    userId,
    task: 'idea_generation',
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 4096,
    scrapeRunId: opts?.scrapeRunId ?? null,
  })

  // 5. Parse + validate
  const parsed = parseIdeas(response.text, pillars.map((p) => p.name))
  if (parsed.length === 0) {
    return { generated: 0, skipped: false, reason: 'AI returned no parseable ideas.', costUsd: response.costUsd, model: response.model }
  }

  // 6. Resolve source URNs to row IDs
  const urns = Array.from(
    new Set([
      ...parsed.flatMap((p) => (p.sourceInspirationUrn ? [p.sourceInspirationUrn] : [])),
      ...parsed.flatMap((p) => (p.sourceScrapedUrn ? [p.sourceScrapedUrn] : [])),
    ]),
  )
  const inspirationIdByUrn = new Map<string, string>()
  const scrapedIdByUrn = new Map<string, string>()
  if (urns.length > 0) {
    const [{ data: insps }, { data: scrs }] = await Promise.all([
      supabase.from('inspiration_posts').select('id, linkedin_urn').eq('user_id', userId).in('linkedin_urn', urns),
      supabase.from('scraped_posts').select('id, linkedin_urn').eq('user_id', userId).in('linkedin_urn', urns),
    ])
    insps?.forEach((r: { id: string; linkedin_urn: string }) => inspirationIdByUrn.set(r.linkedin_urn, r.id))
    scrs?.forEach((r: { id: string; linkedin_urn: string }) => scrapedIdByUrn.set(r.linkedin_urn, r.id))
  }

  // 6b. Score each idea: model's base read, lifted by trend match + the user's historical
  // performance on the idea's topics.
  const [trendMap, perfMap] = await Promise.all([loadTrendWeights(supabase, userId), loadTopicPerformance(supabase, userId)])

  // 7. Insert into ideas
  const rows = parsed.map((p) => ({
    user_id: userId,
    status: 'proposed' as const,
    hook: p.hook,
    angle: p.angle,
    pillar: p.pillar,
    topics: p.topics,
    score: scoreIdea(p, trendMap, perfMap),
    source_type: p.sourceType,
    source_inspiration_post_id: p.sourceInspirationUrn ? inspirationIdByUrn.get(p.sourceInspirationUrn) ?? null : null,
    source_scraped_post_id: p.sourceScrapedUrn ? scrapedIdByUrn.get(p.sourceScrapedUrn) ?? null : null,
    ai_run_id: response.aiRunId || null,
  }))

  const { error: insertErr } = await supabase.from('ideas').insert(rows)
  if (insertErr) throw new Error(`ideas insert failed: ${insertErr.message}`)

  return { generated: rows.length, skipped: false, costUsd: response.costUsd, model: response.model }
}

// ----- Scoring -----
// final = 0.7 * model base + up to +20 for matching a strong current trend + up to +15 for the
// user historically over-performing on the idea's topics. Clamped to 1..100.

function scoreIdea(idea: ParsedIdea, trendMap: Map<string, number>, perfMap: Map<string, number>): number {
  const topics = idea.topics.map((t) => t.toLowerCase())
  let trendWeight = 0
  let perfRatio = 1
  for (const t of topics) {
    if (trendMap.has(t)) trendWeight = Math.max(trendWeight, trendMap.get(t)!)
    if (perfMap.has(t)) perfRatio = Math.max(perfRatio, perfMap.get(t)!)
  }
  const trendBonus = Math.round(20 * trendWeight)
  const perfBonus = Math.round(15 * Math.max(0, Math.min(1, perfRatio - 1)))
  const score = Math.round(0.7 * idea.baseScore + trendBonus + perfBonus)
  return Math.max(1, Math.min(100, score))
}

// topic(lowercased) -> weight 0..1 relative to the top trend, across feed + RSS topics.
async function loadTrendWeights(supabase: Supa, userId: string): Promise<Map<string, number>> {
  const [insp, rss] = await Promise.all([
    supabase.from('inspiration_posts').select('topics').eq('user_id', userId).not('topics', 'is', null).limit(500),
    supabase.from('rss_items').select('topics').eq('user_id', userId).not('topics', 'is', null).limit(500),
  ])
  const counts = new Map<string, number>()
  for (const row of [...((insp.data ?? []) as { topics: string[] | null }[]), ...((rss.data ?? []) as { topics: string[] | null }[])]) {
    for (const raw of row.topics ?? []) {
      const t = raw.trim().toLowerCase()
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  const max = Math.max(1, ...counts.values())
  const weights = new Map<string, number>()
  for (const [t, c] of counts) weights.set(t, c / max)
  return weights
}

// topic(lowercased) -> ratio of the user's avg engagement on that topic vs their overall avg.
async function loadTopicPerformance(supabase: Supa, userId: string): Promise<Map<string, number>> {
  const { data: posts } = await supabase
    .from('scraped_posts')
    .select('id, topics')
    .eq('user_id', userId)
    .not('topics', 'is', null)
    .limit(200)
  const rows = (posts ?? []) as { id: string; topics: string[] | null }[]
  if (rows.length === 0) return new Map()

  const { data: snaps } = await supabase
    .from('post_metric_snapshots')
    .select('post_id, likes, comments, reposts, captured_at')
    .in('post_id', rows.map((p) => p.id))
    .order('captured_at', { ascending: false })

  const engByPost = new Map<string, number>()
  for (const s of (snaps ?? []) as { post_id: string; likes: number | null; comments: number | null; reposts: number | null }[]) {
    if (engByPost.has(s.post_id)) continue
    engByPost.set(s.post_id, (s.likes ?? 0) + (s.comments ?? 0) + (s.reposts ?? 0))
  }
  if (engByPost.size === 0) return new Map()

  let total = 0
  let n = 0
  const byTopic = new Map<string, { sum: number; n: number }>()
  for (const p of rows) {
    const eng = engByPost.get(p.id)
    if (eng === undefined) continue
    total += eng
    n += 1
    for (const raw of p.topics ?? []) {
      const t = raw.trim().toLowerCase()
      if (!t) continue
      const cur = byTopic.get(t) ?? { sum: 0, n: 0 }
      cur.sum += eng
      cur.n += 1
      byTopic.set(t, cur)
    }
  }
  const overall = n > 0 ? total / n : 0
  const ratios = new Map<string, number>()
  if (overall > 0) {
    for (const [t, { sum, n: tn }] of byTopic) ratios.set(t, sum / tn / overall)
  }
  return ratios
}

// ----- Prompt builders + parser -----

function buildUserPrompt(args: {
  profile: { niche: string; audience: string | null; tone: string | null }
  pillars: Array<{ name: string; description: string }>
  ownPosts: Array<{ linkedin_urn: string; body: string | null }>
  inspirations: Array<{ linkedin_urn: string; body: string | null; likes: number | null; comments: number | null }>
  rssItems: Array<{ title: string | null; summary: string | null }>
  existingHooks: string[]
  count: number
}): string {
  const lines: string[] = []

  lines.push(`Generate ${args.count} idea${args.count === 1 ? '' : 's'} based on the context below.`)
  lines.push('')
  lines.push(`PROFILE`)
  lines.push(`- Niche: ${args.profile.niche}`)
  if (args.profile.audience) lines.push(`- Audience: ${args.profile.audience}`)
  if (args.profile.tone) lines.push(`- Tone: ${args.profile.tone}`)
  lines.push('')
  lines.push('PILLARS (assign each idea to exactly one of these by name):')
  for (const p of args.pillars) lines.push(`- "${p.name}": ${p.description}`)

  if (args.ownPosts.length > 0) {
    lines.push('')
    lines.push('USER\'S RECENT OWN POSTS (linkedin_urn → body):')
    for (const p of args.ownPosts) {
      if (!p.body) continue
      lines.push(`- ${p.linkedin_urn}: ${truncate(p.body, 280)}`)
    }
  }

  if (args.inspirations.length > 0) {
    lines.push('')
    lines.push('RECENT INSPIRATION POSTS FROM OTHERS (linkedin_urn, likes/comments → body):')
    for (const i of args.inspirations) {
      if (!i.body) continue
      const counts = `${i.likes ?? '?'}❤ ${i.comments ?? '?'}💬`
      lines.push(`- ${i.linkedin_urn} (${counts}): ${truncate(i.body, 280)}`)
    }
  }

  if (args.rssItems.length > 0) {
    lines.push('')
    lines.push('RECENT NEWSLETTER / BLOG ITEMS (fresh external signal — riff on these for timely, informed takes):')
    for (const r of args.rssItems) {
      if (!r.title && !r.summary) continue
      const title = r.title ? r.title.trim() : ''
      const summary = r.summary ? truncate(r.summary, 220) : ''
      lines.push(`- ${[title, summary].filter(Boolean).join(' — ')}`)
    }
  }

  if (args.existingHooks.length > 0) {
    lines.push('')
    lines.push('EXISTING HOOKS IN QUEUE — your new hooks MUST be different from all of these:')
    for (const h of args.existingHooks) lines.push(`- ${h}`)
  }

  lines.push('')
  lines.push(`Output a JSON array of exactly ${args.count} idea objects, per the schema in the system prompt.`)
  return lines.join('\n')
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

function parseIdeas(text: string, validPillars: string[]): ParsedIdea[] {
  let cleaned = stripJsonFence(text).trim()
  // Tolerate a leading object wrapping the array.
  if (cleaned.startsWith('{')) {
    try {
      const obj = JSON.parse(cleaned) as Record<string, unknown>
      const maybeArr = obj.ideas ?? obj.results ?? obj.items
      if (Array.isArray(maybeArr)) cleaned = JSON.stringify(maybeArr)
    } catch {
      // fall through; we'll try parsing the raw text below
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(cleaned)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  const pillarSet = new Set(validPillars)
  const out: ParsedIdea[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const hook = String(o.hook ?? '').trim()
    const angle = String(o.angle ?? '').trim()
    let pillar = String(o.pillar ?? '').trim()
    const sourceTypeRaw = String(o.source_type ?? '').trim()
    if (!hook || !angle) continue

    // Coerce pillar to a known one (case-insensitive), else fall back to first pillar.
    if (!pillarSet.has(pillar)) {
      const match = validPillars.find((p) => p.toLowerCase() === pillar.toLowerCase())
      pillar = match ?? validPillars[0] ?? ''
    }

    const sourceType: ParsedSourceType =
      sourceTypeRaw === 'inspiration_post' ||
      sourceTypeRaw === 'own_post_pattern' ||
      sourceTypeRaw === 'rss_item' ||
      sourceTypeRaw === 'niche_research'
        ? sourceTypeRaw
        : 'niche_research'

    const topics = Array.isArray(o.topics)
      ? o.topics.map((t) => String(t).trim()).filter((t) => t.length > 0 && t.length < 40).slice(0, 3)
      : []

    const rawScore = Number(o.base_score ?? o.score)
    const baseScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 55

    out.push({
      hook,
      angle,
      pillar,
      topics,
      baseScore,
      sourceType,
      sourceInspirationUrn: nullableUrn(o.source_inspiration_urn),
      sourceScrapedUrn: nullableUrn(o.source_scraped_urn),
    })
  }
  return out
}

function nullableUrn(v: unknown): string | null {
  if (!v || typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed || trimmed === 'null') return null
  return trimmed
}

function stripJsonFence(s: string): string {
  const match = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  return match ? match[1] : s
}
