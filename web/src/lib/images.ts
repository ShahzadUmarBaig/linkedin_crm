// AI image generation ("nano banana" = Gemini 2.5 Flash Image). Generates N variations from a
// prompt, uploads them to a public Supabase Storage bucket, and records the URLs on the draft.

import { GoogleGenAI } from '@google/genai'
import { createSupabaseServiceClient } from './supabase/server'
import { getDecryptedApiKey } from './settings'

// Try the GA id first, then the preview id, in case a project only has access to one.
const IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview']
const BUCKET = 'post-images'
const COST_PER_IMAGE = 0.039 // rough; for budget logging only

type Supa = ReturnType<typeof createSupabaseServiceClient>

export async function generatePostImages(
  userId: string,
  draftId: string,
  prompt: string,
  count = 2,
): Promise<{ urls: string[] }> {
  if (!prompt || prompt.trim().length < 10) throw new Error('Add a longer image prompt first.')

  const apiKey = await getDecryptedApiKey(userId, 'google')
  if (!apiKey) throw new Error('Add a Google API key in Settings to generate images.')
  const ai = new GoogleGenAI({ apiKey })

  const settled = await Promise.allSettled(Array.from({ length: count }, () => generateOne(ai, prompt)))
  const images = settled
    .filter((r): r is PromiseFulfilledResult<{ data: string; mime: string }> => r.status === 'fulfilled' && Boolean(r.value))
    .map((r) => r.value)

  if (images.length === 0) {
    const firstErr = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    const reason = firstErr?.reason instanceof Error ? firstErr.reason.message : 'no image returned'
    throw new Error(`Image generation failed: ${reason}`)
  }

  const supabase = createSupabaseServiceClient()
  await ensureBucket(supabase)

  const stamp = Date.now()
  const urls: string[] = []
  for (let i = 0; i < images.length; i++) {
    const buf = Buffer.from(images[i].data, 'base64')
    const ext = images[i].mime.includes('jpeg') ? 'jpg' : 'png'
    const path = `${userId}/${draftId}/${stamp}-${i}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: images[i].mime, upsert: true })
    if (error) throw new Error(`image upload: ${error.message}`)
    urls.push(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
  }

  await supabase
    .from('drafts')
    .update({ image_urls: urls, selected_image_url: urls[0] ?? null })
    .eq('id', draftId)
    .eq('user_id', userId)

  // Log for budget visibility (image gen bypasses the text budget check).
  await supabase.from('ai_runs').insert({
    user_id: userId,
    task: 'image_generation',
    provider: 'google',
    model: IMAGE_MODELS[0],
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: COST_PER_IMAGE * images.length,
    status: 'success',
  })

  return { urls }
}

// Nightly safety net: generate images for drafts that have a prompt but no images yet (e.g. if
// approve-time generation failed transiently). Bounded to keep cost predictable.
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
      await generatePostImages(userId, d.id, d.image_prompt, 2)
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

async function generateOne(ai: GoogleGenAI, prompt: string): Promise<{ data: string; mime: string }> {
  let lastErr: unknown
  for (const model of IMAGE_MODELS) {
    try {
      const res = await ai.models.generateContent({ model, contents: prompt })
      const parts = res.candidates?.[0]?.content?.parts ?? []
      for (const p of parts) {
        const inline = (p as { inlineData?: { data?: string; mimeType?: string } }).inlineData
        if (inline?.data) return { data: inline.data, mime: inline.mimeType ?? 'image/png' }
      }
      lastErr = new Error('model returned no image part')
    } catch (err) {
      lastErr = err
      // Only fall through to the next model on "not found / unsupported" errors.
      const msg = err instanceof Error ? err.message : String(err)
      if (!/not found|404|unsupported|does not exist|permission|INVALID_ARGUMENT/i.test(msg)) throw err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('image generation failed')
}

async function ensureBucket(supabase: Supa): Promise<void> {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true })
  // Ignore "already exists"; surface anything else.
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`create bucket: ${error.message}`)
  }
}
