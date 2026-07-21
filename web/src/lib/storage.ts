// User-uploaded post images. Mirrors lib/images.ts's storage layout but for images
// the user brings themselves (e.g. from the /compose/new "write from scratch" flow).
// The 'post-images' bucket is shared with AI-generated images; it's created lazily
// (idempotent) on first upload, and is public because LinkedIn embeds require public URLs.

import { randomUUID } from 'node:crypto'
import { createSupabaseServiceClient } from './supabase/server'

const BUCKET = 'post-images'
const MAX_BYTES = 8 * 1024 * 1024 // 8 MB — comfortably above a good JPEG at 1200x628
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

type Supa = ReturnType<typeof createSupabaseServiceClient>

export interface UploadedImage {
  publicUrl: string
  path: string
}

// Upload a user-provided image (from a browser File in a server action) to the shared
// post-images bucket. Returns the public URL suitable for storing in drafts.selected_image_url.
export async function uploadUserPostImage(userId: string, file: File): Promise<UploadedImage> {
  const mime = (file.type || '').toLowerCase()
  const ext = ALLOWED_MIME[mime]
  if (!ext) throw new Error(`Unsupported image type "${mime || 'unknown'}". Use JPG, PNG, WEBP, or GIF.`)
  if (file.size <= 0) throw new Error('Empty image file.')
  if (file.size > MAX_BYTES) throw new Error(`Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — max is 8 MB.`)

  const supabase = createSupabaseServiceClient()
  await ensureBucket(supabase)

  const buf = Buffer.from(await file.arrayBuffer())
  // Path convention matches lib/images.ts: {userId}/... prefix. We don't have a draftId
  // yet at upload time (draft is created after), so bucket the user's manual uploads under
  // /uploads/. On draft creation the URL is stored on the draft; the file stays where it is.
  const path = `${userId}/uploads/${Date.now()}-${randomUUID()}.${ext}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: mime, upsert: false })
  if (error) throw new Error(`image upload: ${error.message}`)

  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  return { publicUrl, path }
}

async function ensureBucket(supabase: Supa): Promise<void> {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true })
  if (error && !/exist/i.test(error.message)) throw new Error(`create bucket: ${error.message}`)
}
