// Idea generation + lifecycle helpers.
// Ideas are speculative + cheap. Drafts are committed + expensive. This split keeps token
// spend bounded: we only ever have ~5 ideas in queue, and a draft is generated only after
// the user explicitly approves an idea.

import { createSupabaseServerClient, createSupabaseServiceClient } from './supabase/server'
import { generate } from './ai/client'

export const IDEA_QUEUE_TARGET = 5

export type IdeaStatus = 'proposed' | 'selected' | 'rejected' | 'scheduled' | 'posted'

export interface IdeaRow {
  id: string
  status: IdeaStatus
  hook: string | null
  angle: string | null
  pillar: string | null
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

Return ONLY a JSON array of 3-5 ideas (no prose, no markdown fences). Each idea object:
{
  "hook":   "the very first line of a hypothetical LinkedIn post — punchy, specific, curiosity- or emotion-driven. <= 120 chars.",
  "angle":  "one sentence on what the post would actually say — the unique take, not the topic.",
  "pillar": "exactly one of the user's pillars (must match by name)",
  "source_type":          "inspiration_post" | "own_post_pattern" | "niche_research",
  "source_inspiration_urn": "the urn of the inspiration post that sparked this, if any (else null)",
  "source_scraped_urn":     "the urn of the user's own past post being riffed on, if any (else null)"
}

Rules:
- Hooks must be distinct from each other AND from the existing-hooks list provided.
- Use the user's tone exactly. If they sound casual, your hooks sound casual; if professional, professional.
- A hook is NOT a question unless the question is provocative or contrarian.
- If you cite an inspiration post, the angle must be a contrarian, additive, or deeper take — never a copy.
- Output a single JSON array. No commentary.`

interface ParsedIdea {
  hook: string
  angle: string
  pillar: string
  sourceType: 'inspiration_post' | 'own_post_pattern' | 'niche_research'
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

  // 3. Gather context: recent own posts + recent inspiration
  const [{ data: ownPosts }, { data: inspirations }, { data: existingIdeas }] = await Promise.all([
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
  ])

  // 4. Build prompts + call AI
  const userPrompt = buildUserPrompt({
    profile: profile as { niche: string; audience: string | null; tone: string | null; pillars: Array<{ name: string; description: string }> },
    pillars,
    ownPosts: ownPosts ?? [],
    inspirations: inspirations ?? [],
    existingHooks: (existingIdeas ?? []).map((i: { hook: string | null }) => i.hook).filter((h): h is string => Boolean(h)),
    count: target,
  })

  const response = await generate({
    userId,
    task: 'idea_generation',
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 2000,
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

  // 7. Insert into ideas
  const rows = parsed.map((p) => ({
    user_id: userId,
    status: 'proposed' as const,
    hook: p.hook,
    angle: p.angle,
    pillar: p.pillar,
    source_type: p.sourceType,
    source_inspiration_post_id: p.sourceInspirationUrn ? inspirationIdByUrn.get(p.sourceInspirationUrn) ?? null : null,
    source_scraped_post_id: p.sourceScrapedUrn ? scrapedIdByUrn.get(p.sourceScrapedUrn) ?? null : null,
    ai_run_id: response.aiRunId || null,
  }))

  const { error: insertErr } = await supabase.from('ideas').insert(rows)
  if (insertErr) throw new Error(`ideas insert failed: ${insertErr.message}`)

  return { generated: rows.length, skipped: false, costUsd: response.costUsd, model: response.model }
}

// ----- Prompt builders + parser -----

function buildUserPrompt(args: {
  profile: { niche: string; audience: string | null; tone: string | null }
  pillars: Array<{ name: string; description: string }>
  ownPosts: Array<{ linkedin_urn: string; body: string | null }>
  inspirations: Array<{ linkedin_urn: string; body: string | null; likes: number | null; comments: number | null }>
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

    const sourceType: ParsedIdea['sourceType'] =
      sourceTypeRaw === 'inspiration_post' || sourceTypeRaw === 'own_post_pattern' || sourceTypeRaw === 'niche_research'
        ? sourceTypeRaw
        : 'niche_research'

    out.push({
      hook,
      angle,
      pillar,
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
