'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { generateIdeas, rejectAllProposed, rejectIdea, updateIdeaFields } from '@/lib/ideas'
import { approveIdea } from '@/lib/drafts'

export async function triggerGenerateIdeas(force = false): Promise<
  { error: string } | { ok: true; generated: number; skipped: boolean; reason?: string; costUsd?: number; model?: string }
> {
  const user = await requireUser()
  try {
    const result = await generateIdeas(user.id, { force })
    revalidatePath('/ideas')
    return { ok: true, ...result }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'generation failed' }
  }
}

export async function rejectIdeaAction(ideaId: string): Promise<{ error?: string; ok?: true }> {
  const user = await requireUser()
  try {
    await rejectIdea(user.id, ideaId)
    revalidatePath('/ideas')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'reject failed' }
  }
}

export async function discardAllIdeasAction(): Promise<{ error?: string; ok?: true; discarded?: number }> {
  const user = await requireUser()
  try {
    const discarded = await rejectAllProposed(user.id)
    revalidatePath('/ideas')
    return { ok: true, discarded }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'discard failed' }
  }
}

export async function updateIdeaAction(
  ideaId: string,
  patch: { hook?: string | null; angle?: string | null; pillar?: string | null },
): Promise<{ error?: string; ok?: true }> {
  const user = await requireUser()
  try {
    await updateIdeaFields(user.id, ideaId, patch)
    revalidatePath('/ideas')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'update failed' }
  }
}

export async function approveIdeaAction(
  ideaId: string,
): Promise<
  | { error: string }
  | { ok: true; draftId: string; slotId: string; scheduledFor: string; schedulingReasoning: string; costUsd: number; model: string }
> {
  const user = await requireUser()
  try {
    const result = await approveIdea(user.id, ideaId)
    revalidatePath('/ideas')
    revalidatePath('/calendar')
    return { ok: true, ...result }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'approve failed' }
  }
}
