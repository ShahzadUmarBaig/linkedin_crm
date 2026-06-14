'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { markSlotPosted, rescheduleSlot, skipSlot, updateDraftBody } from '@/lib/calendar'
import { regenerateDraft, regenerateImagePrompt } from '@/lib/drafts'

export async function markSlotPostedAction(slotId: string): Promise<{ error?: string; ok?: true }> {
  const user = await requireUser()
  try {
    await markSlotPosted(user.id, slotId)
    revalidatePath('/calendar')
    revalidatePath('/ideas')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'failed' }
  }
}

export async function skipSlotAction(slotId: string): Promise<{ error?: string; ok?: true }> {
  const user = await requireUser()
  try {
    await skipSlot(user.id, slotId)
    revalidatePath('/calendar')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'failed' }
  }
}

export async function rescheduleSlotAction(
  slotId: string,
  scheduledForIso: string,
  cascade = false,
): Promise<{ error?: string; ok?: true; shifted?: number }> {
  const user = await requireUser()
  try {
    const { shifted } = await rescheduleSlot(user.id, slotId, scheduledForIso, { cascade })
    revalidatePath('/calendar')
    revalidatePath('/compose')
    revalidatePath('/dashboard')
    return { ok: true, shifted }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'failed' }
  }
}

export async function regenerateDraftAction(
  draftId: string,
): Promise<{ error: string } | { ok: true; body: string; imagePrompt: string | null }> {
  const user = await requireUser()
  try {
    const r = await regenerateDraft(user.id, draftId)
    revalidatePath('/calendar')
    return { ok: true, ...r }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'regenerate failed' }
  }
}

export async function regenerateImagePromptAction(
  draftId: string,
): Promise<{ error: string } | { ok: true; imagePrompt: string }> {
  const user = await requireUser()
  try {
    const r = await regenerateImagePrompt(user.id, draftId)
    revalidatePath('/calendar')
    revalidatePath('/compose')
    return { ok: true, ...r }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'failed' }
  }
}

export async function updateDraftBodyAction(draftId: string, body: string): Promise<{ error?: string; ok?: true }> {
  const user = await requireUser()
  try {
    await updateDraftBody(user.id, draftId, body)
    revalidatePath('/calendar')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'failed' }
  }
}
