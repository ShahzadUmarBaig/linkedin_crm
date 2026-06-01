'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { markSlotPosted, rescheduleSlot, skipSlot, updateDraftBody } from '@/lib/calendar'

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

export async function rescheduleSlotAction(slotId: string, scheduledForIso: string): Promise<{ error?: string; ok?: true }> {
  const user = await requireUser()
  try {
    await rescheduleSlot(user.id, slotId, scheduledForIso)
    revalidatePath('/calendar')
    return { ok: true }
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
