'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { generatePostImages, selectPostImage } from '@/lib/images'

export async function generateImagesAction(
  draftId: string,
  prompt: string,
): Promise<{ error: string } | { ok: true; urls: string[] }> {
  const user = await requireUser()
  try {
    const { urls } = await generatePostImages(user.id, draftId, prompt, 2)
    revalidatePath('/compose')
    revalidatePath('/calendar')
    return { ok: true, urls }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'image generation failed' }
  }
}

export async function selectImageAction(draftId: string, url: string | null): Promise<{ error?: string; ok?: true }> {
  const user = await requireUser()
  try {
    await selectPostImage(user.id, draftId, url)
    revalidatePath('/compose')
    revalidatePath('/calendar')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'failed' }
  }
}
