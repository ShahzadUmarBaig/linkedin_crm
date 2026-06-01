'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { inferProfileFromPosts, saveProfile, type Pillar, type ProfileUpdate } from '@/lib/profile'

export async function inferProfile(): Promise<
  { error: string } | { ok: true; sourcePostCount: number; costUsd: number; model: string }
> {
  const user = await requireUser()
  try {
    const result = await inferProfileFromPosts(user.id)
    revalidatePath('/profile')
    return {
      ok: true,
      sourcePostCount: result.sourcePostCount,
      costUsd: result.costUsd,
      model: result.model,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'inference failed' }
  }
}

export async function updateProfile(formData: FormData): Promise<{ error?: string; ok?: true }> {
  const user = await requireUser()

  const linkedinUrl = (formData.get('linkedinUrl') as string | null)?.trim() || null
  const displayName = (formData.get('displayName') as string | null)?.trim() || null
  const headline = (formData.get('headline') as string | null)?.trim() || null
  const niche = (formData.get('niche') as string | null)?.trim() || null
  const audience = (formData.get('audience') as string | null)?.trim() || null
  const tone = (formData.get('tone') as string | null)?.trim() || null
  const postingFrequencyRaw = formData.get('postingFrequencyPerWeek')
  const postingFrequencyPerWeek = postingFrequencyRaw ? Number(postingFrequencyRaw) : undefined

  const pillarsJson = formData.get('pillarsJson')
  let pillars: Pillar[] | undefined
  if (typeof pillarsJson === 'string' && pillarsJson.trim()) {
    try {
      const parsed = JSON.parse(pillarsJson)
      if (!Array.isArray(parsed)) return { error: 'pillars must be a JSON array' }
      pillars = parsed
        .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
        .map((p) => ({
          name: String(p.name ?? '').trim(),
          description: String(p.description ?? '').trim(),
        }))
        .filter((p) => p.name)
    } catch {
      return { error: 'pillars JSON is invalid' }
    }
  }

  const update: ProfileUpdate = {
    linkedinUrl,
    displayName,
    headline,
    niche,
    audience,
    tone,
    pillars,
    postingFrequencyPerWeek,
  }

  try {
    await saveProfile(user.id, update)
    revalidatePath('/profile')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'failed to save' }
  }
}
