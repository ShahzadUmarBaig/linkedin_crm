'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { saveSettings, type AiProvider, type SettingsUpdate } from '@/lib/settings'

export async function updateSettings(formData: FormData): Promise<{ error?: string; ok?: true }> {
  const user = await requireUser()

  const update: SettingsUpdate = {}

  // Keys field has two inputs sharing a name: the password input and a "__clear__" checkbox.
  // Rules (clear wins if both submitted):
  //   - clear checkbox present → null out the key
  //   - non-empty typed value  → set to that value
  //   - neither                → leave alone
  applyKeyUpdate(update, 'anthropicKey', formData.getAll('anthropicKey'))
  applyKeyUpdate(update, 'googleKey', formData.getAll('googleKey'))

  const provider = formData.get('defaultProvider')
  if (provider === 'anthropic' || provider === 'google') {
    update.defaultProvider = provider as AiProvider
  }

  const model = formData.get('defaultModel')
  if (typeof model === 'string') {
    update.defaultModel = model.trim() || null
  }

  const warn = formData.get('monthlyBudgetWarnUsd')
  if (typeof warn === 'string') {
    update.monthlyBudgetWarnUsd = warn.trim() === '' ? null : Number(warn)
  }
  const hard = formData.get('monthlyBudgetHardUsd')
  if (typeof hard === 'string') {
    update.monthlyBudgetHardUsd = hard.trim() === '' ? null : Number(hard)
  }

  try {
    await saveSettings(user.id, update)
    revalidatePath('/settings')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'failed to save' }
  }
}

function applyKeyUpdate(
  update: SettingsUpdate,
  key: 'anthropicKey' | 'googleKey',
  values: FormDataEntryValue[],
): void {
  const strings = values.filter((v): v is string => typeof v === 'string')
  if (strings.includes('__clear__')) {
    update[key] = null
    return
  }
  const typed = strings.find((v) => v.length > 0)
  if (typed) update[key] = typed
}
