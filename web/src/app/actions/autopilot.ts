'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { saveSettings } from '@/lib/settings'
import { runAutopilotForUser } from '@/lib/autopilot'

export async function setAutopilotAction(enabled: boolean): Promise<{ error?: string; ok?: true }> {
  const user = await requireUser()
  try {
    await saveSettings(user.id, { autopilotEnabled: enabled })
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'failed to update autopilot' }
  }
}

export async function runAutopilotNowAction(): Promise<
  { error: string } | { ok: true; topicsProcessed: number; ideasGenerated: number; ideasSkippedReason?: string }
> {
  const user = await requireUser()
  try {
    const r = await runAutopilotForUser(user.id)
    if (r.error) return { error: r.error }
    revalidatePath('/ideas')
    revalidatePath('/signals')
    revalidatePath('/dashboard')
    return { ok: true, topicsProcessed: r.topicsProcessed, ideasGenerated: r.ideasGenerated, ideasSkippedReason: r.ideasSkippedReason }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'autopilot run failed' }
  }
}
