// Approve → Draft → Schedule pipeline.
// Triggered when the user clicks "Approve" on an idea on /ideas.
// One AI call produces both the full LinkedIn post body AND an optimal calendar slot.

import { createSupabaseServiceClient } from './supabase/server'
import { generate } from './ai/client'
import { generatePostImages } from './images'
import { pickOptimalSlot } from './insights'
import type { IdeaRow } from './ideas'

export interface ApproveIdeaResult {
  draftId: string
  slotId: string
  scheduledFor: string
  schedulingReasoning: string
  costUsd: number
  model: string
}

export async function approveIdea(userId: string, ideaId: string): Promise<ApproveIdeaResult> {
  const supabase = createSupabaseServiceClient()

  // 1. Load the idea + ensure it's still proposed/selected (not already drafted)
  const { data: idea, error: ideaErr } = await supabase
    .from('ideas')
    .select('*')
    .eq('id', ideaId)
    .eq('user_id', userId)
    .maybeSingle()
  if (ideaErr) throw new Error(`load idea: ${ideaErr.message}`)
  if (!idea) throw new Error('Idea not found.')
  if (idea.status === 'scheduled' || idea.status === 'posted') {
    throw new Error(`Idea already ${idea.status}.`)
  }

  // 2. Mark idea as selected (intent recorded even if AI fails)
  await supabase
    .from('ideas')
    .update({ status: 'selected', selected_at: new Date().toISOString() })
    .eq('id', ideaId)
    .eq('user_id', userId)

  // 3. Gather context: profile + source post body + history + existing slots
  const [{ data: profile }, sourceBody, historyByHour, upcomingSlots] = await Promise.all([
    supabase.from('profile').select('niche, audience, tone, pillars, posting_frequency_per_week').eq('user_id', userId).maybeSingle(),
    loadSourceBody(supabase, userId, idea as IdeaRow),
    loadEngagementHistory(supabase, userId),
    loadUpcomingSlots(supabase, userId),
  ])
  if (!profile) throw new Error('Profile not set — visit /profile first.')

  // 4. AI call: produce body + scheduledFor + reasoning
  const system = SYSTEM_PROMPT
  const user = buildUserPrompt({
    profile: profile as ProfileContext,
    idea: idea as IdeaRow,
    sourceBody,
    historyByHour,
    upcomingSlotIsos: upcomingSlots,
    now: new Date(),
  })

  const response = await generate({
    userId,
    task: 'draft_write',
    system,
    user,
    maxTokens: 4096,
  })

  const parsed = parseDraftResponse(response.text)
  if (!parsed) {
    throw new Error('AI did not return a valid draft. Try again.')
  }

  // 5. Insert draft
  const { data: draft, error: draftErr } = await supabase
    .from('drafts')
    .insert({
      user_id: userId,
      idea_id: ideaId,
      body: parsed.body,
      image_prompt: parsed.imagePrompt,
      version: 1,
      ai_run_id: response.aiRunId || null,
    })
    .select('id')
    .single()
  if (draftErr || !draft) throw new Error(`drafts insert: ${draftErr?.message}`)

  // 6. Choose the slot from the user's own performance data (best day + time), not the AI's
  // guess. Falls back to a weekday-morning default until there's enough history.
  const optimal = await pickOptimalSlot(userId, { avoidIsos: upcomingSlots })

  const { data: slot, error: slotErr } = await supabase
    .from('calendar_slots')
    .insert({
      user_id: userId,
      draft_id: draft.id,
      scheduled_for: optimal.iso,
      ai_chosen: true,
      ai_reasoning: optimal.reasoning,
      status: 'scheduled',
    })
    .select('id')
    .single()
  if (slotErr || !slot) throw new Error(`calendar_slots insert: ${slotErr?.message}`)

  // 7. Update idea status to scheduled
  await supabase
    .from('ideas')
    .update({ status: 'scheduled' })
    .eq('id', ideaId)
    .eq('user_id', userId)

  // 8. Auto-generate the visual so the post is fully ready on review. Best-effort: never let an
  // image failure (no Google key, transient API error) block the approval.
  if (parsed.imagePrompt) {
    try {
      await generatePostImages(userId, draft.id, parsed.imagePrompt, 2)
    } catch (err) {
      console.error('[approve] image generation failed (draft still created)', err)
    }
  }

  return {
    draftId: draft.id,
    slotId: slot.id,
    scheduledFor: optimal.iso,
    schedulingReasoning: optimal.reasoning,
    costUsd: response.costUsd,
    model: response.model,
  }
}

// Re-run draft generation for an existing draft (e.g. to pick up new prompt rules like hashtags
// + the detailed image prompt) without touching its calendar slot.
export async function regenerateDraft(
  userId: string,
  draftId: string,
): Promise<{ body: string; imagePrompt: string | null }> {
  const supabase = createSupabaseServiceClient()

  const { data: draft } = await supabase
    .from('drafts')
    .select('id, idea_id')
    .eq('id', draftId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!draft?.idea_id) throw new Error('Draft or its idea not found.')

  const { data: idea } = await supabase.from('ideas').select('*').eq('id', draft.idea_id).eq('user_id', userId).maybeSingle()
  if (!idea) throw new Error('Idea not found.')

  const [{ data: profile }, sourceBody, historyByHour, upcomingSlots] = await Promise.all([
    supabase.from('profile').select('niche, audience, tone, pillars, posting_frequency_per_week').eq('user_id', userId).maybeSingle(),
    loadSourceBody(supabase, userId, idea as IdeaRow),
    loadEngagementHistory(supabase, userId),
    loadUpcomingSlots(supabase, userId),
  ])
  if (!profile) throw new Error('Profile not set.')

  const user = buildUserPrompt({
    profile: profile as ProfileContext,
    idea: idea as IdeaRow,
    sourceBody,
    historyByHour,
    upcomingSlotIsos: upcomingSlots,
    now: new Date(),
  })

  const response = await generate({ userId, task: 'draft_write', system: SYSTEM_PROMPT, user, maxTokens: 4096 })
  const parsed = parseDraftResponse(response.text)
  if (!parsed) throw new Error('AI did not return a valid draft. Try again.')

  const { error } = await supabase
    .from('drafts')
    .update({ body: parsed.body, image_prompt: parsed.imagePrompt, ai_run_id: response.aiRunId || null, updated_at: new Date().toISOString() })
    .eq('id', draftId)
    .eq('user_id', userId)
  if (error) throw new Error(`draft update: ${error.message}`)

  return { body: parsed.body, imagePrompt: parsed.imagePrompt }
}

// ---------- context loaders ----------

type Supa = ReturnType<typeof createSupabaseServiceClient>

async function loadSourceBody(supabase: Supa, userId: string, idea: IdeaRow): Promise<string | null> {
  if (idea.source_inspiration_post_id) {
    const { data } = await supabase
      .from('inspiration_posts')
      .select('body')
      .eq('id', idea.source_inspiration_post_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (data?.body) return data.body
  }
  if (idea.source_scraped_post_id) {
    const { data } = await supabase
      .from('scraped_posts')
      .select('body')
      .eq('id', idea.source_scraped_post_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (data?.body) return data.body
  }
  return null
}

interface HistoryBucket {
  dayOfWeek: number  // 0 = Sunday
  hourUtc: number    // 0..23
  count: number
  avgEngagement: number  // (likes + comments + reposts) / count
}

async function loadEngagementHistory(supabase: Supa, userId: string): Promise<HistoryBucket[]> {
  // Join the latest snapshot per post with the post's posted_at, bucket by (DOW, hour).
  // For V1 we just pull the latest snapshot per post and aggregate in JS — small data,
  // single user.
  const { data: posts } = await supabase
    .from('scraped_posts')
    .select('id, posted_at')
    .eq('user_id', userId)
    .not('posted_at', 'is', null)
    .order('posted_at', { ascending: false })
    .limit(60)
  if (!posts || posts.length === 0) return []

  const postIds = posts.map((p) => p.id)
  const { data: snaps } = await supabase
    .from('post_metric_snapshots')
    .select('post_id, likes, comments, reposts, captured_at')
    .in('post_id', postIds)
    .order('captured_at', { ascending: false })
  if (!snaps || snaps.length === 0) return []

  // Latest snapshot per post.
  const latestByPost = new Map<string, { likes: number; comments: number; reposts: number }>()
  for (const s of snaps) {
    if (latestByPost.has(s.post_id)) continue
    latestByPost.set(s.post_id, {
      likes: s.likes ?? 0,
      comments: s.comments ?? 0,
      reposts: s.reposts ?? 0,
    })
  }

  const buckets = new Map<string, { sum: number; count: number; dow: number; hour: number }>()
  for (const post of posts) {
    const snap = latestByPost.get(post.id)
    if (!snap || !post.posted_at) continue
    const d = new Date(post.posted_at)
    const dow = d.getUTCDay()
    const hour = d.getUTCHours()
    const eng = snap.likes + snap.comments + snap.reposts
    const key = `${dow}-${hour}`
    const cur = buckets.get(key) ?? { sum: 0, count: 0, dow, hour }
    cur.sum += eng
    cur.count += 1
    buckets.set(key, cur)
  }

  return Array.from(buckets.values()).map((b) => ({
    dayOfWeek: b.dow,
    hourUtc: b.hour,
    count: b.count,
    avgEngagement: b.count > 0 ? b.sum / b.count : 0,
  }))
}

async function loadUpcomingSlots(supabase: Supa, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('calendar_slots')
    .select('scheduled_for')
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .gte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(30)
  return (data ?? []).map((r) => r.scheduled_for)
}

// ---------- prompt ----------

interface ProfileContext {
  niche: string | null
  audience: string | null
  tone: string | null
  pillars: Array<{ name: string; description: string }>
  posting_frequency_per_week: number
}

const SYSTEM_PROMPT = `You complete an approved LinkedIn post idea into (a) a publishable draft, (b) the
optimal date/time to post it, and (c) a detailed image-generation prompt.

Return ONLY a JSON object (no prose, no markdown fences):
{
  "body": "The full LinkedIn post. 150-300 words. The provided 'hook' MUST be line 1 verbatim or near-verbatim. Use LinkedIn formatting: short paragraphs, blank lines between thoughts. End with a question or CTA, THEN a final line with 3-5 relevant hashtags. Match the user's tone EXACTLY.",
  "scheduledFor": "ISO 8601 datetime in UTC. Must be at least 24 hours from the current time. Must not duplicate any time already in 'existingSlotsIso'. Pick a slot consistent with the user's past best-engagement windows; if there's no signal, default to a weekday morning (Tue/Wed/Thu around 14:00 UTC = 9am ET).",
  "schedulingReasoning": "One short sentence on WHY this slot. Reference the history data if it informed the choice.",
  "imagePrompt": "A SINGLE detailed image-generation prompt, AT LEAST 400 words, for an AI image model. Describe ONE cohesive visual that complements the post. Cover, in rich detail: the core subject/scene and what it conveys; composition & framing (rule of thirds, focal point, negative space for text overlay); art style (e.g. minimal 3D render, editorial flat illustration, cinematic photo); exact color palette with hex-like descriptions and how it ties to a calm professional LinkedIn aesthetic; lighting (direction, softness, mood); mood & emotional tone; specific objects/metaphors that reinforce the post's message; background treatment; texture & material detail; depth of field; perspective/camera angle; aspect ratio 1.91:1 (landscape, LinkedIn-optimal); and a short list of things to AVOID (no text/words in the image, no logos, no clutter, no stock-photo cliches). Be concrete and vivid, not generic."
}

Rules:
- The body MUST end with a final line of 3-5 relevant hashtags (mix of 1-2 broad + 2-3 niche). Use the user's pillars/topics to pick them. CamelCase multi-word tags (e.g. #SoftwareEngineering).
- The body must NOT mention the source/inspiration post directly.
- The body should sound like the user wrote it from scratch, not like an AI summary.
- Avoid generic LinkedIn cliches ("excited to share", "I'm thrilled", "let me know your thoughts").
- imagePrompt must be ONE prompt (not 2), at least 400 words, vivid and specific.`

function buildUserPrompt(args: {
  profile: ProfileContext
  idea: IdeaRow
  sourceBody: string | null
  historyByHour: HistoryBucket[]
  upcomingSlotIsos: string[]
  now: Date
}): string {
  const lines: string[] = []

  lines.push(`Current time: ${args.now.toISOString()}`)
  lines.push(`Posting frequency target: ${args.profile.posting_frequency_per_week} posts per week`)
  lines.push('')
  lines.push('PROFILE')
  if (args.profile.niche) lines.push(`- Niche: ${args.profile.niche}`)
  if (args.profile.audience) lines.push(`- Audience: ${args.profile.audience}`)
  if (args.profile.tone) lines.push(`- Tone: ${args.profile.tone}`)
  if (args.profile.pillars.length > 0) {
    lines.push('- Pillars:')
    for (const p of args.profile.pillars) lines.push(`  • "${p.name}": ${p.description}`)
  }

  lines.push('')
  lines.push('IDEA TO EXPAND')
  if (args.idea.hook) lines.push(`- Hook: ${args.idea.hook}`)
  if (args.idea.angle) lines.push(`- Angle: ${args.idea.angle}`)
  if (args.idea.pillar) lines.push(`- Pillar: ${args.idea.pillar}`)

  if (args.sourceBody) {
    lines.push('')
    lines.push('SOURCE POST that sparked this idea (for context only — do NOT mention it):')
    lines.push(`"""${truncate(args.sourceBody, 500)}"""`)
  }

  lines.push('')
  lines.push('PAST ENGAGEMENT HISTORY (day-of-week in UTC, hour in UTC, post count, avg engagement)')
  if (args.historyByHour.length === 0) {
    lines.push('(no history yet — pick a sensible default weekday morning)')
  } else {
    // Sort by avgEngagement desc, top 12.
    const sorted = [...args.historyByHour].sort((a, b) => b.avgEngagement - a.avgEngagement).slice(0, 12)
    for (const b of sorted) {
      lines.push(`- DOW=${b.dayOfWeek} (${dowName(b.dayOfWeek)}) hour=${b.hourUtc}:00 UTC, ${b.count} posts, avg ${b.avgEngagement.toFixed(1)}`)
    }
  }

  lines.push('')
  lines.push('existingSlotsIso (do NOT pick any of these or any time within ±1 hour of them):')
  if (args.upcomingSlotIsos.length === 0) {
    lines.push('(none)')
  } else {
    for (const iso of args.upcomingSlotIsos) lines.push(`- ${iso}`)
  }

  lines.push('')
  lines.push('Return the JSON object as specified.')
  return lines.join('\n')
}

function dowName(d: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d] ?? '?'
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

interface ParsedDraftResponse {
  body: string
  scheduledFor: string
  schedulingReasoning: string
  imagePrompt: string | null
}

function parseDraftResponse(text: string): ParsedDraftResponse | null {
  let cleaned = stripJsonFence(text).trim()
  // Some models prefix with text before the JSON object. Extract from first { to last }.
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace > 0 || lastBrace !== cleaned.length - 1) {
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1)
    }
  }

  let raw: unknown
  try {
    raw = JSON.parse(cleaned)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const body = String(o.body ?? '').trim()
  const scheduledForRaw = String(o.scheduledFor ?? '').trim()
  const schedulingReasoning = String(o.schedulingReasoning ?? '').trim()
  const imagePrompt = String(o.imagePrompt ?? o.image_prompt ?? '').trim() || null
  if (!body || !scheduledForRaw) return null

  const dt = new Date(scheduledForRaw)
  if (isNaN(dt.getTime())) return null
  // Validate min 1 hour in the future (relax the 24h rule — AI may pick anything; we just sanity-check).
  if (dt.getTime() < Date.now() + 60 * 60 * 1000) {
    // Bump it to 24h from now to avoid scheduling in the past.
    return {
      body,
      scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      schedulingReasoning: schedulingReasoning + ' (auto-bumped: AI picked too soon)',
      imagePrompt,
    }
  }

  return { body, scheduledFor: dt.toISOString(), schedulingReasoning, imagePrompt }
}

function stripJsonFence(s: string): string {
  const match = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  return match ? match[1] : s
}
