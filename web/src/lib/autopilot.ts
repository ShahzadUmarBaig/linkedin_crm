// Autopilot — the nightly pipeline. Scraping is client-side (the extension), so the server
// job does the steps it can: tag any new posts with topics, then top up the idea queue so
// fresh approvals are waiting each morning. Drafting + scheduling stay human-triggered
// (approve) per the product model.

import { createSupabaseServiceClient } from './supabase/server'
import { extractTopicsForUser } from './topics'
import { generateIdeas } from './ideas'
import { refreshAllFeedsForUser } from './rss'

export interface AutopilotRunResult {
  userId: string
  rssItemsAdded: number
  topicsProcessed: number
  ideasGenerated: number
  ideasSkippedReason?: string
  error?: string
}

export async function runAutopilotForUser(userId: string): Promise<AutopilotRunResult> {
  const result: AutopilotRunResult = { userId, rssItemsAdded: 0, topicsProcessed: 0, ideasGenerated: 0 }

  // 1. Pull fresh RSS/newsletter items so they're available to tag + feed ideas.
  try {
    const r = await refreshAllFeedsForUser(userId)
    result.rssItemsAdded = r.itemsAdded
  } catch (err) {
    console.error(`[autopilot] rss refresh failed for ${userId}`, err)
  }

  // 2. Topic tagging — best-effort; a failure here shouldn't block idea generation.
  try {
    const t = await extractTopicsForUser(userId)
    result.topicsProcessed = t.processed
  } catch (err) {
    console.error(`[autopilot] topics failed for ${userId}`, err)
  }

  // 2. Top up the idea queue to target.
  try {
    const r = await generateIdeas(userId, { force: false })
    result.ideasGenerated = r.generated
    if (r.skipped) result.ideasSkippedReason = r.reason
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'idea generation failed'
  }

  // 3. Stamp the run.
  try {
    const supabase = createSupabaseServiceClient()
    await supabase.from('settings').update({ last_autopilot_run_at: new Date().toISOString() }).eq('user_id', userId)
  } catch (err) {
    console.error(`[autopilot] stamp failed for ${userId}`, err)
  }

  return result
}

// Run for every user who has autopilot enabled. Used by the nightly cron.
export async function runAutopilotAll(): Promise<AutopilotRunResult[]> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.from('settings').select('user_id').eq('autopilot_enabled', true)
  if (error) throw new Error(`autopilot: list users failed: ${error.message}`)

  const results: AutopilotRunResult[] = []
  for (const row of (data ?? []) as { user_id: string }[]) {
    try {
      results.push(await runAutopilotForUser(row.user_id))
    } catch (err) {
      results.push({
        userId: row.user_id,
        rssItemsAdded: 0,
        topicsProcessed: 0,
        ideasGenerated: 0,
        error: err instanceof Error ? err.message : 'autopilot run failed',
      })
    }
  }
  return results
}
