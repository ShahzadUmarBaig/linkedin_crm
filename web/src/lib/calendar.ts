// Calendar reads + slot mutations (mark posted, edit body, reschedule, skip).

import { createSupabaseServerClient } from './supabase/server'

export type SlotStatus = 'scheduled' | 'posted' | 'skipped'

export interface CalendarSlotView {
  slot_id: string
  scheduled_for: string
  status: SlotStatus
  ai_chosen: boolean
  ai_reasoning: string | null
  posted_at: string | null
  draft_id: string | null
  draft_body: string | null
  draft_image_prompt: string | null
  draft_image_urls: string[] | null
  draft_selected_image_url: string | null
  idea_id: string | null
  idea_hook: string | null
  idea_pillar: string | null
}

export async function listSlots(userId: string, opts?: { status?: SlotStatus; future?: boolean }): Promise<CalendarSlotView[]> {
  const supabase = await createSupabaseServerClient()

  let q = supabase
    .from('calendar_slots')
    .select(`
      id,
      scheduled_for,
      status,
      ai_chosen,
      ai_reasoning,
      posted_at,
      draft_id,
      drafts:draft_id ( id, body, image_prompt, image_urls, selected_image_url, idea_id, ideas:idea_id ( id, hook, pillar ) )
    `)
    .eq('user_id', userId)
    .order('scheduled_for', { ascending: true })

  if (opts?.status) q = q.eq('status', opts.status)
  if (opts?.future) q = q.gte('scheduled_for', new Date().toISOString())

  const { data, error } = await q
  if (error) throw new Error(`listSlots failed: ${error.message}`)

  type Row = {
    id: string
    scheduled_for: string
    status: SlotStatus
    ai_chosen: boolean
    ai_reasoning: string | null
    posted_at: string | null
    draft_id: string | null
    // Supabase relational select returns either an object or an array depending on schema cardinality.
    drafts:
      | DraftJoin
      | null
      | DraftJoin[]
  }
  type DraftJoin = {
    id: string
    body: string | null
    image_prompt: string | null
    image_urls: string[] | null
    selected_image_url: string | null
    idea_id: string | null
    ideas: { id: string; hook: string | null; pillar: string | null } | { id: string; hook: string | null; pillar: string | null }[] | null
  }

  return (data as Row[] | null ?? []).map((r) => {
    const draft = Array.isArray(r.drafts) ? r.drafts[0] : r.drafts
    const ideaUnion = draft?.ideas
    const idea = Array.isArray(ideaUnion) ? ideaUnion[0] : ideaUnion
    return {
      slot_id: r.id,
      scheduled_for: r.scheduled_for,
      status: r.status,
      ai_chosen: r.ai_chosen,
      ai_reasoning: r.ai_reasoning,
      posted_at: r.posted_at,
      draft_id: draft?.id ?? null,
      draft_body: draft?.body ?? null,
      draft_image_prompt: draft?.image_prompt ?? null,
      draft_image_urls: draft?.image_urls ?? null,
      draft_selected_image_url: draft?.selected_image_url ?? null,
      idea_id: draft?.idea_id ?? idea?.id ?? null,
      idea_hook: idea?.hook ?? null,
      idea_pillar: idea?.pillar ?? null,
    }
  })
}

export async function markSlotPosted(userId: string, slotId: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const now = new Date().toISOString()

  // Update slot.
  const { data: slot, error: slotErr } = await supabase
    .from('calendar_slots')
    .update({ status: 'posted', posted_at: now })
    .eq('id', slotId)
    .eq('user_id', userId)
    .select('draft_id')
    .single()
  if (slotErr) throw new Error(`markSlotPosted: ${slotErr.message}`)

  // Cascade: idea linked via draft → status='posted'
  if (slot?.draft_id) {
    const { data: draft } = await supabase
      .from('drafts')
      .select('idea_id')
      .eq('id', slot.draft_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (draft?.idea_id) {
      await supabase
        .from('ideas')
        .update({ status: 'posted' })
        .eq('id', draft.idea_id)
        .eq('user_id', userId)
    }
  }
}

export async function skipSlot(userId: string, slotId: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('calendar_slots')
    .update({ status: 'skipped' })
    .eq('id', slotId)
    .eq('user_id', userId)
  if (error) throw new Error(`skipSlot: ${error.message}`)
}

export async function rescheduleSlot(
  userId: string,
  slotId: string,
  newIso: string,
  opts?: { cascade?: boolean },
): Promise<{ shifted: number }> {
  const supabase = await createSupabaseServerClient()
  const dt = new Date(newIso)
  if (isNaN(dt.getTime())) throw new Error('Invalid date.')

  if (!opts?.cascade) {
    const { error } = await supabase
      .from('calendar_slots')
      .update({ scheduled_for: dt.toISOString(), ai_chosen: false, ai_reasoning: 'Rescheduled manually.' })
      .eq('id', slotId)
      .eq('user_id', userId)
    if (error) throw new Error(`rescheduleSlot: ${error.message}`)
    return { shifted: 1 }
  }

  // Cascade: shift every still-scheduled (not posted/skipped) slot by the same delta, so the whole
  // queue moves while keeping its spacing.
  const { data: cur, error: curErr } = await supabase
    .from('calendar_slots')
    .select('scheduled_for')
    .eq('id', slotId)
    .eq('user_id', userId)
    .single()
  if (curErr || !cur) throw new Error(`rescheduleSlot: slot not found`)
  const delta = dt.getTime() - new Date(cur.scheduled_for).getTime()

  const { data: slots, error: listErr } = await supabase
    .from('calendar_slots')
    .select('id, scheduled_for')
    .eq('user_id', userId)
    .eq('status', 'scheduled')
  if (listErr) throw new Error(`rescheduleSlot: ${listErr.message}`)

  let shifted = 0
  for (const s of (slots ?? []) as { id: string; scheduled_for: string }[]) {
    const nt = new Date(new Date(s.scheduled_for).getTime() + delta).toISOString()
    const { error } = await supabase
      .from('calendar_slots')
      .update({ scheduled_for: nt, ai_chosen: false, ai_reasoning: 'Shifted with the schedule.' })
      .eq('id', s.id)
      .eq('user_id', userId)
    if (!error) shifted += 1
  }
  return { shifted }
}

export async function updateDraftBody(userId: string, draftId: string, body: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('drafts')
    .update({ body, updated_at: new Date().toISOString() })
    .eq('id', draftId)
    .eq('user_id', userId)
  if (error) throw new Error(`updateDraftBody: ${error.message}`)
}
