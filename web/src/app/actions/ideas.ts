'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { generateIdeas, rejectIdea, updateIdeaFields } from '@/lib/ideas'

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

// approveIdeaAction will trigger draft generation + scheduling — coming in the next step.
export async function approveIdeaAction(_ideaId: string): Promise<{ error: string }> {
  await requireUser()
  return { error: 'Approve flow not built yet — comes with the draft writer.' }
}
