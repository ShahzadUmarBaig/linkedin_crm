// Outcome attribution (learning-loop Stage E1).
//
// Links a generated draft → the real own LinkedIn post it became (scraped_posts.draft_id),
// so downstream stages can read "this draft, with this hook/length/format, actually earned
// this engagement". Auto-matches on post body similarity after each scrape; a manual link
// action covers the cases auto-match can't confidently resolve (edited posts, etc.).

import { createSupabaseServerClient, createSupabaseServiceClient } from './supabase/server'

type DB = ReturnType<typeof createSupabaseServiceClient>

// Normalise post text for comparison: drop hashtags, urls, punctuation, case, whitespace.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/#\w+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Similarity = word-set Jaccard over the first ~40 words, plus a prefix bonus. LinkedIn
// reformats whitespace but keeps wording, so the opening matching strongly is a good signal.
function similarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  const wa = na.split(' ').slice(0, 40)
  const wb = nb.split(' ').slice(0, 40)
  const sa = new Set(wa)
  const sb = new Set(wb)
  let inter = 0
  for (const w of sa) if (sb.has(w)) inter++
  const jaccard = inter / (sa.size + sb.size - inter || 1)
  const prefix = na.slice(0, 60) === nb.slice(0, 60) ? 0.2 : 0
  return Math.min(1, jaccard + prefix)
}

const MATCH_THRESHOLD = 0.6

/** Auto-link posted drafts to their scraped own-post, by body similarity. Returns # linked. */
export async function attributePostedDrafts(userId: string, supabase: DB): Promise<number> {
  // Drafts that were actually posted (their slot is 'posted').
  const { data: slots } = await supabase
    .from('calendar_slots')
    .select('drafts:draft_id ( id, body )')
    .eq('user_id', userId)
    .eq('status', 'posted')
  // The embedded `drafts` relation can come back as an object or a single-element array
  // depending on the client's type inference — normalise to the row.
  const postedDrafts = ((slots ?? []) as unknown[])
    .map((s) => {
      const d = (s as { drafts: unknown }).drafts
      return (Array.isArray(d) ? d[0] : d) as { id: string; body: string | null } | null
    })
    .filter((d): d is { id: string; body: string } => !!d?.id && !!d.body)
  if (postedDrafts.length === 0) return 0

  // Drafts already linked → skip.
  const { data: linkedRows } = await supabase
    .from('scraped_posts')
    .select('draft_id')
    .eq('user_id', userId)
    .not('draft_id', 'is', null)
  const linked = new Set((linkedRows ?? []).map((r: { draft_id: string }) => r.draft_id))
  const targets = postedDrafts.filter((d) => !linked.has(d.id))
  if (targets.length === 0) return 0

  // Candidate own posts not yet attributed.
  const { data: posts } = await supabase
    .from('scraped_posts')
    .select('id, body')
    .eq('user_id', userId)
    .is('draft_id', null)
    .not('body', 'is', null)
  const candidates = (posts ?? []) as { id: string; body: string }[]
  if (candidates.length === 0) return 0

  let count = 0
  const used = new Set<string>()
  for (const d of targets) {
    let best: { id: string } | null = null
    let bestScore = 0
    for (const p of candidates) {
      if (used.has(p.id)) continue
      const score = similarity(d.body, p.body)
      if (score > bestScore) {
        bestScore = score
        best = p
      }
    }
    if (best && bestScore >= MATCH_THRESHOLD) {
      const { error } = await supabase.from('scraped_posts').update({ draft_id: d.id }).eq('id', best.id).eq('user_id', userId)
      if (!error) {
        used.add(best.id)
        count++
      }
    }
  }
  return count
}

export interface UnlinkedPost {
  id: string
  body: string | null
  posted_at: string | null
}

/** Own scraped posts not yet attributed to a draft — for the manual-link picker. */
export async function listUnlinkedOwnPosts(userId: string): Promise<UnlinkedPost[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('scraped_posts')
    .select('id, body, posted_at')
    .eq('user_id', userId)
    .is('draft_id', null)
    .order('posted_at', { ascending: false, nullsFirst: false })
    .limit(20)
  return (data ?? []) as UnlinkedPost[]
}

/** Manually attribute a posted draft to a specific scraped own-post. */
export async function linkDraftToScrapedPost(userId: string, draftId: string, scrapedPostId: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  // Clear any prior link for this draft, then set the new one (one draft ↔ one post).
  await supabase.from('scraped_posts').update({ draft_id: null }).eq('user_id', userId).eq('draft_id', draftId)
  const { error } = await supabase
    .from('scraped_posts')
    .update({ draft_id: draftId })
    .eq('id', scrapedPostId)
    .eq('user_id', userId)
  if (error) throw new Error(`link draft: ${error.message}`)
}
