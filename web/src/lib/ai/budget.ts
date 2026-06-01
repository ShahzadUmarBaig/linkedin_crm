// Monthly budget enforcement for AI calls.
// Sums ai_runs.cost_usd for the current calendar month and compares to settings.

import { createSupabaseServiceClient } from '@/lib/supabase/server'

export interface BudgetCheck {
  spentThisMonthUsd: number
  warnAtUsd: number | null
  hardCapUsd: number | null
  shouldWarn: boolean
  shouldBlock: boolean
}

export async function checkBudget(userId: string): Promise<BudgetCheck> {
  const supabase = createSupabaseServiceClient()

  const start = startOfThisMonth().toISOString()

  const [{ data: spent, error: spentErr }, { data: settings, error: settingsErr }] = await Promise.all([
    supabase
      .from('ai_runs')
      .select('cost_usd')
      .eq('user_id', userId)
      .gte('created_at', start),
    supabase
      .from('settings')
      .select('monthly_budget_warn_usd, monthly_budget_hard_usd')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  if (spentErr) throw new Error(`budget read failed: ${spentErr.message}`)
  if (settingsErr) throw new Error(`settings read failed: ${settingsErr.message}`)

  const spentThisMonthUsd = (spent ?? []).reduce(
    (sum, r) => sum + Number(r.cost_usd ?? 0),
    0,
  )

  const warnAtUsd = settings?.monthly_budget_warn_usd ?? null
  const hardCapUsd = settings?.monthly_budget_hard_usd ?? null

  return {
    spentThisMonthUsd,
    warnAtUsd,
    hardCapUsd,
    shouldWarn: warnAtUsd != null && spentThisMonthUsd >= warnAtUsd,
    shouldBlock: hardCapUsd != null && spentThisMonthUsd >= hardCapUsd,
  }
}

function startOfThisMonth(): Date {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

export class BudgetExceededError extends Error {
  constructor(public readonly check: BudgetCheck) {
    super(`Monthly AI budget reached ($${check.spentThisMonthUsd.toFixed(4)} / $${check.hardCapUsd}).`)
    this.name = 'BudgetExceededError'
  }
}
