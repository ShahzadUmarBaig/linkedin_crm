// Server-only helpers for reading and writing the per-user `settings` row.
// API keys are encrypted with APP_ENCRYPTION_KEY before insert and decrypted on read.

import { createSupabaseServerClient } from './supabase/server'
import { decrypt, encrypt, maskKey } from './crypto'

export type AiProvider = 'anthropic' | 'google'

// What the UI sees: keys are NEVER returned in plaintext, only as a presence flag + masked preview.
export interface SettingsView {
  hasAnthropicKey: boolean
  anthropicKeyMasked: string
  hasGoogleKey: boolean
  googleKeyMasked: string
  defaultProvider: AiProvider
  defaultModel: string | null
  taskModelOverrides: Record<string, string>
  monthlyBudgetWarnUsd: number | null
  monthlyBudgetHardUsd: number | null
  autopilotEnabled: boolean
  lastAutopilotRunAt: string | null
}

export interface SettingsUpdate {
  anthropicKey?: string | null   // null = clear; undefined = leave alone
  googleKey?: string | null
  defaultProvider?: AiProvider
  defaultModel?: string | null
  taskModelOverrides?: Record<string, string>
  monthlyBudgetWarnUsd?: number | null
  monthlyBudgetHardUsd?: number | null
  autopilotEnabled?: boolean
}

export async function loadSettings(userId: string): Promise<SettingsView> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(`settings load failed: ${error.message}`)

  const anthropic = data?.anthropic_api_key_encrypted ? safeDecrypt(data.anthropic_api_key_encrypted) : null
  const google = data?.google_api_key_encrypted ? safeDecrypt(data.google_api_key_encrypted) : null

  return {
    hasAnthropicKey: Boolean(anthropic),
    anthropicKeyMasked: maskKey(anthropic),
    hasGoogleKey: Boolean(google),
    googleKeyMasked: maskKey(google),
    defaultProvider: (data?.default_provider ?? 'anthropic') as AiProvider,
    defaultModel: data?.default_model ?? null,
    taskModelOverrides: (data?.task_model_overrides ?? {}) as Record<string, string>,
    monthlyBudgetWarnUsd: data?.monthly_budget_warn_usd ?? null,
    monthlyBudgetHardUsd: data?.monthly_budget_hard_usd ?? null,
    autopilotEnabled: data?.autopilot_enabled ?? true,
    lastAutopilotRunAt: data?.last_autopilot_run_at ?? null,
  }
}

export async function saveSettings(userId: string, update: SettingsUpdate): Promise<void> {
  const supabase = await createSupabaseServerClient()

  const patch: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() }

  if (update.anthropicKey !== undefined) {
    patch.anthropic_api_key_encrypted = update.anthropicKey ? encrypt(update.anthropicKey) : null
  }
  if (update.googleKey !== undefined) {
    patch.google_api_key_encrypted = update.googleKey ? encrypt(update.googleKey) : null
  }
  if (update.defaultProvider !== undefined) patch.default_provider = update.defaultProvider
  if (update.defaultModel !== undefined) patch.default_model = update.defaultModel
  if (update.taskModelOverrides !== undefined) patch.task_model_overrides = update.taskModelOverrides
  if (update.monthlyBudgetWarnUsd !== undefined) patch.monthly_budget_warn_usd = update.monthlyBudgetWarnUsd
  if (update.monthlyBudgetHardUsd !== undefined) patch.monthly_budget_hard_usd = update.monthlyBudgetHardUsd
  if (update.autopilotEnabled !== undefined) patch.autopilot_enabled = update.autopilotEnabled

  const { error } = await supabase.from('settings').upsert(patch, { onConflict: 'user_id' })
  if (error) throw new Error(`settings save failed: ${error.message}`)
}

// Decrypted-key getter for server-side AI callers. Never reach for this from a client component.
export async function getDecryptedApiKey(
  userId: string,
  provider: AiProvider,
): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const column = provider === 'anthropic' ? 'anthropic_api_key_encrypted' : 'google_api_key_encrypted'
  const { data, error } = await supabase
    .from('settings')
    .select(column)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`settings read failed: ${error.message}`)
  const encrypted = (data as Record<string, string | null> | null)?.[column]
  return encrypted ? safeDecrypt(encrypted) : null
}

function safeDecrypt(payload: string): string | null {
  try {
    return decrypt(payload)
  } catch {
    return null
  }
}
