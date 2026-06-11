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

  // 4b. Guard the image prompt: rewrite it around a real object if the model
  // slipped into abstract AI-stock-art (robots, glowing data, holograms, UI…).
  const imagePrompt = await ensureConcreteImagePrompt(userId, parsed.imagePrompt, {
    body: parsed.body,
    concreteSubject: parsed.concreteSubject,
  })

  // 5. Insert draft
  const { data: draft, error: draftErr } = await supabase
    .from('drafts')
    .insert({
      user_id: userId,
      idea_id: ideaId,
      body: parsed.body,
      image_prompt: imagePrompt,
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
  if (imagePrompt) {
    try {
      await generatePostImages(userId, draft.id, imagePrompt, 1)
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

  const imagePrompt = await ensureConcreteImagePrompt(userId, parsed.imagePrompt, {
    body: parsed.body,
    concreteSubject: parsed.concreteSubject,
  })

  const { error } = await supabase
    .from('drafts')
    .update({ body: parsed.body, image_prompt: imagePrompt, ai_run_id: response.aiRunId || null, updated_at: new Date().toISOString() })
    .eq('id', draftId)
    .eq('user_id', userId)
  if (error) throw new Error(`draft update: ${error.message}`)

  return { body: parsed.body, imagePrompt }
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
  "body": "The full LinkedIn post in PLAIN TEXT (no markdown). 150-300 words. The provided 'hook' MUST be line 1 verbatim or near-verbatim. Short paragraphs with a blank line between them. Write in very simple, everyday English (see VOICE rules). End with a simple question, THEN a final line with 3-5 relevant hashtags. Keep the user's personality, but always in plain, simple words.",
  "scheduledFor": "ISO 8601 datetime in UTC. Must be at least 24 hours from the current time. Must not duplicate any time already in 'existingSlotsIso'. Pick a slot consistent with the user's past best-engagement windows; if there's no signal, default to a weekday morning (Tue/Wed/Thu around 14:00 UTC = 9am ET).",
  "schedulingReasoning": "One short sentence on WHY this slot. Reference the history data if it informed the choice.",
  "centralArgument": "In ONE short sentence: the post's single specific claim or argument — NOT its broad topic. ('Adapting beats fearing the AI shift' — not 'AI and careers'.)",
  "concreteSubject": "ONE concrete, real, physical, photographable object or staged real-world scene that visually argues that claim — something a photographer could actually place on a table or stage in a room. This is MANDATORY and it must NOT be a robot, a hand, a hologram, a glowing data/code stream, a brain, a circuit board, a phone/screen UI, or any floating digital element.",
  "imagePrompt": "ONE rock-solid prompt for the FLUX.2 [pro] text-to-image model, built ENTIRELY around 'concreteSubject'. See the imagePrompt rules below for exactly how to write it."
}

Rules:
- The body MUST end with a final line of 3-5 relevant hashtags (mix of 1-2 broad + 2-3 niche). Use the user's pillars/topics to pick them. CamelCase multi-word tags (e.g. #SoftwareEngineering).
- The body must NOT mention the source/inspiration post directly.
- The body should sound like the user wrote it from scratch, not like an AI summary.
- Avoid generic LinkedIn cliches ("excited to share", "I'm thrilled", "let me know your thoughts").

VOICE & READABILITY (this matters a lot):
- Write in VERY SIMPLE English that someone who learned English as a second language can read easily. Target a 6th-8th grade reading level.
- Short sentences — most under ~15 words, one idea per sentence. Use common, everyday words. Use contractions (I'm, don't, it's).
- Sound like a real person talking to a friend — warm, direct, plain. NOT a corporate post, NOT an essay, NOT literary.
- Swap fancy/formal words for plain ones. Examples: "hidden behind a like or comment" not "dangled behind an engagement barrier"; "make hard things easy to understand" not "demystifying complex topics"; "goes against" not "counter to the spirit of"; "use" not "utilize"; "help" not "facilitate"; "a lot" not "a plethora".
- Spoon-feed the point: explain it plainly like you're helping someone learn. No jargon unless you explain it in simple words right away.

FORMATTING (LinkedIn shows PLAIN TEXT only — this is critical):
- NEVER use markdown or formatting symbols: no asterisks (* or **), no underscores (_), no backticks, no # headings, no bold or italic. LinkedIn does NOT render them — they appear as literal characters and instantly look AI-generated.
- Emphasize with word choice and short lines, never with symbols.
- If you list a few points, put each on its own short line (you may begin a line with a plain "-"), but prefer short flowing sentences over lists.

imagePrompt rules (written FOR the FLUX.2 [pro] model — depict the ARGUMENT with ONE real object, NEVER abstract tech art):
- HARD BAN (this is the most important rule). These tropes instantly look like generic AI stock art, and FLUX renders them as unreadable gibberish. NEVER depict, name, or imply ANY of: robots, androids, humanoids, cyborgs, drones, robotic/mechanical/bionic hands; glowing "data", "code", "information", or "light" streams, trails, or particles; holograms or holographic projections; floating UI, dashboards, screens, icons, glyphs, or symbols; phones/laptops showing an interface; neural networks, node-and-line webs, glowing brains, circuit boards, motherboards, binary/matrix code. Also NEVER use the words "abstract", "digital", "futuristic", "cyber", "high-tech", or "tech" to describe the scene. If your first idea contains ANY of these, discard it and choose a real, physical, everyday object instead.
- Build the whole prompt AROUND the 'concreteSubject' field you already committed to above: ONE real, physical, photographable object or staged real-world scene, with a small storytelling DETAIL that carries the argument. The viewer should "get it" from a real object, the way a good magazine photo essay works.
- WORKED EXAMPLES (notice: every subject is a real thing you could hold):
  • "stop gating knowledge behind engagement" → a chrome stanchion post with its red velvet rope UNCLIPPED and dropped on the floor in front of an open, warmly lit doorway. The dropped rope IS the message.
  • "LLMs erode my career, so adapt instead of fear" → a well-worn wooden hand plane resting on a half-finished dovetail joint with fresh curls of wood shaving around it — old craft, still building by hand. (NOT a robot hand.)
  • "you can build anything now, but you still have zero users" → a single freshly-baked pie cooling on a windowsill, perfect and untouched, with a stack of clean empty plates beside it and no people. The empty plates ARE the message. (NOT a phone showing a user count.)
- Write the prompt as ONE paragraph, ~110-180 words — vivid but tight, FLUX follows focused prompts far better than bloated ones.
- FRONT-LOAD that one concrete subject in the very first sentence (a single clear focal subject — FLUX is most accurate with ONE subject, not a busy scene).
- Then describe, in this order: a REAL-WORLD art style (pick one: "soft cinematic product photograph", "matte still-life photograph", "clean minimal 3D render of a real object", "editorial flat-vector illustration"), composition & framing (focal point + generous negative space), a calm 2-3 colour palette (professional LinkedIn aesthetic), lighting (direction + softness), and mood.
- Use POSITIVE phrasing only — FLUX ignores "no X" lists. Say "a clean, wordless composition" rather than "no text".
- Include this exact clause near the end: "landscape orientation, a clean wordless composition with no text or lettering, no logos, no watermarks".
- For posts about data, numbers, growth, or metrics: depict a SINGLE real chart on a physical surface (one line drawn flat along the bottom of a paper graph, a bar chart on a whiteboard, a printed report) — never a screen, app UI, or floating graphic.
- End with: "high detail, sharp focus, professional, 4k".

FINAL CHECK before you answer — re-read your imagePrompt. If it mentions a robot, a hand, glowing data/code, a hologram, floating icons/UI, a screen interface, a brain, a circuit board, or the words abstract/digital/futuristic/cyber/tech, then it is WRONG: rewrite it around a single real, physical object. The image must look like a photograph of a real thing sitting in the real world, not like AI art.`

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
  concreteSubject: string | null
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

  const body = sanitizeBody(String(o.body ?? ''))
  const scheduledForRaw = String(o.scheduledFor ?? '').trim()
  const schedulingReasoning = String(o.schedulingReasoning ?? '').trim()
  const imagePrompt = String(o.imagePrompt ?? o.image_prompt ?? '').trim() || null
  const concreteSubject = String(o.concreteSubject ?? o.concrete_subject ?? '').trim() || null
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
      concreteSubject,
    }
  }

  return { body, scheduledFor: dt.toISOString(), schedulingReasoning, imagePrompt, concreteSubject }
}

// LinkedIn renders plain text only. Strip any markdown the model slips in so asterisks/headings
// never reach the post (they read as AI-generated). Keeps hashtags intact.
function sanitizeBody(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold**
    .replace(/__(.+?)__/g, '$1') // __bold__
    .replace(/\*(.+?)\*/g, '$1') // *italic*
    .replace(/`/g, '') // backticks
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // markdown headings (not hashtags — those have no space)
    .replace(/^\s*\*\s+/gm, '- ') // leftover "* " bullets → "- "
    .replace(/\n{3,}/g, '\n\n') // collapse extra blank lines
    .trim()
}

function stripJsonFence(s: string): string {
  const match = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  return match ? match[1] : s
}

// ---------- image-prompt cliché guard ----------
// Deterministic backstop: even with the hardened spec, the model occasionally
// slips into AI-stock-art tropes (robots, glowing data, holograms, floating UI),
// which read as "AI slop" and which FLUX renders as gibberish. We detect those
// and rewrite the prompt ONCE around a real, physical object.
const CLICHE_PATTERNS: RegExp[] = [
  /\b(robot|robotic|android|humanoid|cyborg|bionic|drone)\b/i,
  /\b(mechanical|robotic) hand\b/i,
  /\bhologram|holographic\b/i,
  /\b(neural network|circuit board|motherboard|binary code|silicon)\b/i,
  /\bglowing (data|code|lines|particles|stream|dots|network|orb)\b/i,
  /\b(data|code|light|information) stream\b/i,
  /\bstream of (data|code|light|information|particles)\b/i,
  /\bfloating (ui|icons?|elements?|interface|screens?|panels?|holograms?|symbols?|glyphs?)\b/i,
  /\b(glowing|digital) brain\b/i,
  /\b(futuristic|cyberpunk|sci-?fi|high-tech|cyber)\b/i,
  /\babstract\b/i,
]

export function isClichedImagePrompt(prompt: string): boolean {
  return CLICHE_PATTERNS.some((re) => re.test(prompt))
}

// Returns a clean, concrete prompt. If the given prompt is already clean, returns it
// unchanged (no extra AI call). Only on a cliché hit does it spend one cheap rewrite.
export async function ensureConcreteImagePrompt(
  userId: string,
  imagePrompt: string | null,
  ctx: { body: string; concreteSubject: string | null },
): Promise<string | null> {
  if (!imagePrompt || !isClichedImagePrompt(imagePrompt)) return imagePrompt

  const system = `You fix text-to-image prompts that drifted into generic AI stock art.
Rewrite the prompt so it depicts ONE concrete, real, physical, photographable object or staged real-world scene that works as a visual metaphor for the post's argument — the way a magazine photo essay makes a point with a real object.
HARD BAN — never depict, name, or imply: robots, androids, drones, robotic/mechanical/bionic hands; glowing data/code/light streams, trails, or particles; holograms; floating UI, icons, screens, dashboards, glyphs, or symbols; phones/laptops showing an interface; neural networks, glowing brains, circuit boards, binary code. Never use the words abstract, digital, futuristic, cyber, or tech to describe the scene.
Keep it to ONE paragraph, ~110-160 words: front-load the single real object, then a real-world art style (e.g. "soft cinematic product photograph", "matte still-life photograph", "clean minimal 3D render of a real object"), composition with generous negative space, a calm 2-3 colour palette, soft directional lighting, and mood. Include near the end: "landscape orientation, a clean wordless composition with no text or lettering, no logos, no watermarks". End with "high detail, sharp focus, professional, 4k".
Return ONLY the rewritten prompt paragraph — no preamble, no quotes, no JSON.`

  const subjectHint = ctx.concreteSubject
    ? `Use this real-object metaphor as the subject: ${ctx.concreteSubject}`
    : `Invent a fitting real, physical, everyday-object metaphor for the post.`
  const user = `POST:\n${ctx.body}\n\n${subjectHint}\n\nThe current prompt is too abstract / AI-stock and must be rewritten:\n${imagePrompt}`

  try {
    const r = await generate({ userId, task: 'draft_write', system, user, maxTokens: 700 })
    const rewritten = stripJsonFence(r.text).replace(/^["'\s]+|["'\s]+$/g, '').trim()
    if (rewritten.length > 40 && !isClichedImagePrompt(rewritten)) return rewritten
  } catch (err) {
    console.error('[drafts] image-prompt rewrite failed; using original', err)
  }
  return imagePrompt
}
