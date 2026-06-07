'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { extractTopicsForUser } from '@/lib/topics'

export async function extractTopicsAction(): Promise<
  { error: string } | { ok: true; processed: number; skipped: boolean; reason?: string; costUsd?: number; model?: string }
> {
  const user = await requireUser()
  try {
    const result = await extractTopicsForUser(user.id)
    revalidatePath('/signals')
    revalidatePath('/analytics')
    return { ok: true, ...result }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'topic extraction failed' }
  }
}
