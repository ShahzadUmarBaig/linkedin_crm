// AI image generation via fal.ai → FLUX.1 [dev]. Generates one image from a prompt, re-uploads
// it to a public Supabase Storage bucket (so we own the asset), and records the URL on the draft.
// Auth is a single server env var (FAL_KEY) — no per-user key, no Google-billing hassle.

import { fal } from '@fal-ai/client'
import { createSupabaseServiceClient } from './supabase/server'

const FLUX_MODEL = 'fal-ai/flux/dev' // $0.025/image; swap to 'fal-ai/flux/schnell' for cheaper/faster
const BUCKET = 'post-images'
const COST_PER_IMAGE = 0.025
// LinkedIn-friendly landscape (~1.91:1).
const IMAGE_SIZE = { width: 1200, height: 628 }

type Supa = ReturnType<typeof createSupabaseServiceClient>

let configured = false
function ensureConfigured(): boolean {
  // Accept the user's var name (FALAIKEY) plus the fal SDK conventions.
  const key = process.env.FALAIKEY ?? process.env.FAL_KEY ?? process.env.FAL_API_KEY
  if (!key) return false
  if (!configured) {
    fal.config({ credentials: key })
    configured = true
  }
  return true
}

interface FalImageResult {
  images?: Array<{ url?: string; content_type?: string }>
}

export async function generatePostImages(
  userId: string,
  draftId: string,
  prompt: string,
  count = 1,
): Promise<{ urls: string[] }> {
  if (!prompt || prompt.trim().length < 10) throw new Error('Add a longer image prompt first.')
  if (!ensureConfigured()) throw new Error('Image generation not configured — set FALAIKEY in the environment.')

  let data: FalImageResult
  try {
    const res = await fal.subscribe(FLUX_MODEL, {
      input: {
        prompt: prompt.trim(),
        image_size: IMAGE_SIZE,
        num_images: count,
        num_inference_steps: 28,
        enable_safety_checker: true,
      },
    })
    data = res.data as FalImageResult
  } catch (err) {
    throw new Error(`Image generation failed: ${err instanceof Error ? err.message : 'fal request error'}`)
  }

  const sources = (data.images ?? []).map((i) => i.url).filter((u): u is string => Boolean(u))
  if (sources.length === 0) throw new Error('Image generation returned no image.')

  const supabase = createSupabaseServiceClient()
  await ensureBucket(supabase)

  const stamp = Date.now()
  const urls: string[] = []
  for (let i = 0; i < sources.length; i++) {
    const resp = await fetch(sources[i])
    if (!resp.ok) throw new Error(`fetch generated image: ${resp.status}`)
    const buf = Buffer.from(await resp.arrayBuffer())
    const mime = resp.headers.get('content-type') ?? 'image/png'
    const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
    const path = `${userId}/${draftId}/${stamp}-${i}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: true })
    if (error) throw new Error(`image upload: ${error.message}`)
    urls.push(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
  }

  await supabase
    .from('drafts')
    .update({ image_urls: urls, selected_image_url: urls[0] ?? null })
    .eq('id', draftId)
    .eq('user_id', userId)

  // Best-effort cost log (needs 'fal' in the ai_provider enum — migration 0009).
  try {
    await supabase.from('ai_runs').insert({
      user_id: userId,
      task: 'image_generation',
      provider: 'fal',
      model: FLUX_MODEL,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: COST_PER_IMAGE * urls.length,
      status: 'success',
    })
  } catch {
    /* enum may not include 'fal' yet — cost tracking is optional */
  }

  return { urls }
}

// Nightly safety net: generate the image for any draft with a prompt but no image yet.
export async function backfillMissingImages(userId: string, max = 5): Promise<number> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('drafts')
    .select('id, image_prompt')
    .eq('user_id', userId)
    .not('image_prompt', 'is', null)
    .is('image_urls', null)
    .order('created_at', { ascending: false })
    .limit(max)

  let generated = 0
  for (const d of (data ?? []) as { id: string; image_prompt: string }[]) {
    try {
      await generatePostImages(userId, d.id, d.image_prompt, 1)
      generated += 1
    } catch (err) {
      console.error(`[autopilot] image backfill failed for draft ${d.id}`, err)
    }
  }
  return generated
}

export async function selectPostImage(userId: string, draftId: string, url: string | null): Promise<void> {
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('drafts')
    .update({ selected_image_url: url })
    .eq('id', draftId)
    .eq('user_id', userId)
  if (error) throw new Error(`select image: ${error.message}`)
}

// ---------- internals ----------

async function ensureBucket(supabase: Supa): Promise<void> {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true })
  if (error && !/exist/i.test(error.message)) throw new Error(`create bucket: ${error.message}`)
}
