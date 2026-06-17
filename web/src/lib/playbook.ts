// Reflection pass (learning-loop Stage E3).
//
// Periodically re-reads what's actually working (the content-insights profile + the bodies of
// the top-performing posts) and writes a short, evolving "creator playbook" — concrete rules
// for THIS creator. The playbook is then injected into idea + draft generation, so the engine
// literally updates its own instructions from results over time.

import { createSupabaseServiceClient } from './supabase/server'
import { generate } from './ai/client'
import { getContentInsights, type ContentInsights } from './content-insights'

type DB = ReturnType<typeof createSupabaseServiceClient>

export async function getCreatorPlaybook(userId: string, supabase: DB): Promise<string | null> {
  const { data } = await supabase.from('profile').select('playbook').eq('user_id', userId).maybeSingle()
  const pb = (data as { playbook: string | null } | null)?.playbook
  return pb && pb.trim() ? pb.trim() : null
}

const SYSTEM_PROMPT = `You are a sharp LinkedIn growth strategist writing a private "playbook" for ONE creator,
based ONLY on the evidence given (what's measurably working for them and in their niche).

Write 5-8 short, CONCRETE, actionable rules this creator should follow to get more engagement.
Rules must be specific and evidence-based — reference the actual winning topics, formats, hook
styles and lengths from the data. No generic advice ("be authentic", "post consistently").
Each rule is one line, imperative, plain English. Include 1-2 "avoid" rules if the data supports them.

Return ONLY the playbook as plain text bullet lines starting with "- ". No preamble, no headings.`

function buildContext(insights: ContentInsights): string {
  const fmt = (label: string, arr: { label: string; multiplier: number; posts: number }[]) =>
    arr.length ? `${label}: ${arr.slice(0, 6).map((r) => `${r.label} ${r.multiplier.toFixed(1)}x (${r.posts})`).join(', ')}` : ''
  const lines = [
    `Sample: ${insights.sampleSize} posts (${insights.ownSampleSize} are the creator's own, weighted higher).`,
    fmt('Top topics', insights.topTopics),
    fmt('Formats', insights.formats),
    fmt('Hook styles', insights.hookStyles),
    fmt('Length', insights.lengthBands),
  ].filter(Boolean)
  if (insights.topPosts.length) {
    lines.push('Top-performing post openings:')
    for (const p of insights.topPosts) lines.push(`  • (${p.likes}❤ ${p.comments}💬 ${p.reposts}🔁) ${(p.body ?? '').slice(0, 160).replace(/\n/g, ' ')}`)
  }
  return lines.join('\n')
}

/** Recompute the playbook from current evidence and store it on profile. No-op without signal. */
export async function refreshCreatorPlaybook(userId: string, supabase: DB): Promise<{ updated: boolean; reason?: string }> {
  const insights = await getContentInsights(userId, supabase)
  if (!insights.hasData) return { updated: false, reason: 'not enough data' }

  const response = await generate({
    userId,
    task: 'idea_generation',
    system: SYSTEM_PROMPT,
    user: `Evidence for this creator:\n\n${buildContext(insights)}\n\nWrite the playbook now.`,
    maxTokens: 700,
  })
  const playbook = response.text.trim()
  if (!playbook || playbook.length < 20) return { updated: false, reason: 'empty playbook' }

  const { error } = await supabase
    .from('profile')
    .update({ playbook, playbook_updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) return { updated: false, reason: error.message }
  return { updated: true }
}
