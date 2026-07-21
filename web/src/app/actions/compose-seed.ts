'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { composeDraftFromSeed } from '@/lib/drafts'
import { uploadUserPostImage } from '@/lib/storage'

// "Write from scratch" action. Called from /compose/new. Takes the user's rough seed
// (headline hint + body hint + optional image) and produces a full draft + calendar slot
// via the same intelligence stack as the approve-idea flow.
//
// Returns the new draft/slot IDs so the client can redirect into /compose to refine.
// FormData shape: headlineHint (string), bodyHint (string), image? (File).
export async function composeFromSeedAction(
  formData: FormData,
): Promise<
  | { error: string }
  | { ok: true; draftId: string; slotId: string; scheduledFor: string; costUsd: number; model: string }
> {
  const user = await requireUser()

  const headlineHint = String(formData.get('headlineHint') ?? '').trim()
  const bodyHint = String(formData.get('bodyHint') ?? '').trim()
  if (!headlineHint && !bodyHint) return { error: 'Add at least a headline hint or a body hint.' }

  // Image is optional. Browsers send an empty File (name="", size=0) when the input is left
  // untouched, so gate on size to distinguish "no upload" from "real upload".
  const imageField = formData.get('image')
  const imageFile: File | null =
    imageField instanceof File && imageField.size > 0 ? imageField : null

  let imageUrl: string | null = null
  if (imageFile) {
    try {
      const uploaded = await uploadUserPostImage(user.id, imageFile)
      imageUrl = uploaded.publicUrl
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'image upload failed' }
    }
  }

  try {
    const result = await composeDraftFromSeed(user.id, { headlineHint, bodyHint, imageUrl })
    revalidatePath('/calendar')
    revalidatePath('/compose')
    revalidatePath('/dashboard')
    return {
      ok: true,
      draftId: result.draftId,
      slotId: result.slotId,
      scheduledFor: result.scheduledFor,
      costUsd: result.costUsd,
      model: result.model,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'compose failed' }
  }
}
