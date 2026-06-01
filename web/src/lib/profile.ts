// Profile inference + persistence.
// "Infer" reads the user's scraped posts and asks the AI to extract niche/pillars/tone/audience.
// All fields are user-editable after inference.

import { createSupabaseServerClient, createSupabaseServiceClient } from './supabase/server'
import { generate } from './ai/client'

export interface Pillar {
  name: string
  description: string
}

export interface ProfileRow {
  user_id: string
  linkedin_url: string | null
  display_name: string | null
  headline: string | null
  niche: string | null
  audience: string | null
  tone: string | null
  pillars: Pillar[]
  posting_frequency_per_week: number
  inferred_at: string | null
  inference_source_post_count: number
  updated_at: string
}

export async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('profile')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`profile load failed: ${error.message}`)
  if (!data) return null
  return {
    ...data,
    pillars: (data.pillars ?? []) as Pillar[],
  } as ProfileRow
}

export interface ProfileUpdate {
  linkedinUrl?: string | null
  displayName?: string | null
  headline?: string | null
  niche?: string | null
  audience?: string | null
  tone?: string | null
  pillars?: Pillar[]
  postingFrequencyPerWeek?: number
}

export async function saveProfile(userId: string, update: ProfileUpdate): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const patch: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() }
  if (update.linkedinUrl !== undefined) patch.linkedin_url = update.linkedinUrl
  if (update.displayName !== undefined) patch.display_name = update.displayName
  if (update.headline !== undefined) patch.headline = update.headline
  if (update.niche !== undefined) patch.niche = update.niche
  if (update.audience !== undefined) patch.audience = update.audience
  if (update.tone !== undefined) patch.tone = update.tone
  if (update.pillars !== undefined) patch.pillars = update.pillars
  if (update.postingFrequencyPerWeek !== undefined) patch.posting_frequency_per_week = update.postingFrequencyPerWeek

  const { error } = await supabase.from('profile').upsert(patch, { onConflict: 'user_id' })
  if (error) throw new Error(`profile save failed: ${error.message}`)
}

// ----- Inference -----

const SYSTEM_PROMPT = `You analyze a person's LinkedIn posts and infer their personal brand profile.

Return ONLY a JSON object matching this EXACT shape. Note that "pillars" MUST be an array of
objects, each with both a "name" string AND a "description" string. Do NOT use bare strings.

EXAMPLE of the required shape:
{
  "niche": "Helping early-stage founders ship faster by combining product-led thinking with AI tools.",
  "audience": "Solo founders and product-leaning engineers at pre-seed to seed stage who are shipping their first SaaS.",
  "tone": "Direct, slightly contrarian, with concrete anecdotes from real shipping decisions.",
  "pillars": [
    { "name": "Shipping with AI", "description": "How to use Claude, Cursor, and Codex to compress weeks of work into days without producing slop." },
    { "name": "Founder reality", "description": "Unfiltered notes on the gap between startup advice and what actually moves the needle when you're 3 people." },
    { "name": "Product-engineering bridge", "description": "Why most engineer-founders ship the wrong thing first, and how to fix it before raising." }
  ]
}

Rules:
- 3 to 5 pillars. Each pillar is an OBJECT with "name" (2-4 words) AND "description" (one sentence).
- Pillars must be distinct from each other — different themes, not synonyms.
- Base your answer ONLY on the posts. If posts are sparse, still produce pillars but make them tentative.
- Match the user's voice, not the example's voice — the example is for SHAPE only.
- Output a single JSON object. No prose, no markdown fences, no preamble.`

interface InferenceOutput {
  niche: string
  audience: string
  tone: string
  pillars: Pillar[]
}

export interface InferProfileResult {
  inferred: InferenceOutput
  sourcePostCount: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  model: string
}

export async function inferProfileFromPosts(userId: string): Promise<InferProfileResult> {
  // Use service client to bypass RLS for a server-side read of user's own data.
  const supabase = createSupabaseServiceClient()
  const { data: posts, error } = await supabase
    .from('scraped_posts')
    .select('body, posted_at, media')
    .eq('user_id', userId)
    .not('body', 'is', null)
    .order('posted_at', { ascending: false, nullsFirst: false })
    .limit(50)

  if (error) throw new Error(`failed to read scraped_posts: ${error.message}`)
  if (!posts || posts.length === 0) {
    throw new Error('No scraped posts yet. Scrape your own LinkedIn activity first.')
  }

  const userPrompt = buildUserPrompt(posts.map((p) => ({ body: p.body ?? '', postedAt: p.posted_at, media: p.media })))

  const response = await generate({
    userId,
    task: 'profile_inference',
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 4096,
  })

  const inferred = parseInference(response.text)

  await saveProfile(userId, {
    niche: inferred.niche,
    audience: inferred.audience,
    tone: inferred.tone,
    pillars: inferred.pillars,
  })

  // Update inference metadata separately to avoid clobbering display_name etc.
  await supabase
    .from('profile')
    .update({
      inferred_at: new Date().toISOString(),
      inference_source_post_count: posts.length,
    })
    .eq('user_id', userId)

  return {
    inferred,
    sourcePostCount: posts.length,
    costUsd: response.costUsd,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    model: response.model,
  }
}

function buildUserPrompt(posts: Array<{ body: string; postedAt: string | null; media: string | null }>): string {
  const lines = posts.map((p, i) => {
    const date = p.postedAt ? p.postedAt.slice(0, 10) : 'unknown date'
    const media = p.media ?? 'text'
    return `--- Post ${i + 1} (${date}, ${media}) ---\n${p.body}`
  })
  return `Here are my ${posts.length} most recent LinkedIn posts. Infer my profile.\n\n${lines.join('\n\n')}`
}

function parseInference(text: string): InferenceOutput {
  const cleaned = stripJsonFence(text).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`AI did not return valid JSON. First 200 chars: ${cleaned.slice(0, 200)}`)
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('AI response was not an object')
  const obj = parsed as Record<string, unknown>
  const niche = String(obj.niche ?? '')
  const audience = String(obj.audience ?? '')
  const tone = String(obj.tone ?? '')
  // Gemini sometimes returns pillars as plain strings instead of {name, description} objects.
  // Be forgiving: accept either shape.
  const rawPillars = Array.isArray(obj.pillars) ? obj.pillars : []
  const pillars: Pillar[] = rawPillars
    .map((p): Pillar | null => {
      if (typeof p === 'string') {
        const name = p.trim()
        return name ? { name, description: '' } : null
      }
      if (typeof p === 'object' && p !== null) {
        const o = p as Record<string, unknown>
        const name = String(o.name ?? o.title ?? '').trim()
        const description = String(o.description ?? o.desc ?? o.detail ?? '').trim()
        return name ? { name, description } : null
      }
      return null
    })
    .filter((p): p is Pillar => p !== null)

  if (!niche || !audience || !tone || pillars.length === 0) {
    throw new Error('AI response missing required fields.')
  }
  return { niche, audience, tone, pillars }
}

function stripJsonFence(s: string): string {
  const match = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  return match ? match[1] : s
}
