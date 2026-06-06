// Compose screen loader. After an idea is approved, the AI has already produced a
// draft body + a calendar slot. Compose is where you review/edit that draft and its
// visual before it sits in the calendar. We load by slot id (passed from /ideas),
// else fall back to the soonest upcoming scheduled slot.

import { listSlots, type CalendarSlotView } from './calendar'

export interface ComposeView extends CalendarSlotView {}

export async function getComposeView(
  userId: string,
  opts?: { slotId?: string; draftId?: string },
): Promise<ComposeView | null> {
  const all = await listSlots(userId)
  if (all.length === 0) return null

  if (opts?.slotId) {
    const bySlot = all.find((s) => s.slot_id === opts.slotId)
    if (bySlot) return bySlot
  }
  if (opts?.draftId) {
    const byDraft = all.find((s) => s.draft_id === opts.draftId)
    if (byDraft) return byDraft
  }

  // Fallback: soonest upcoming scheduled slot, else the most recent slot.
  const now = Date.now()
  const upcoming = all
    .filter((s) => s.status === 'scheduled' && new Date(s.scheduled_for).getTime() >= now)
    .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime())
  if (upcoming.length > 0) return upcoming[0]

  return all[all.length - 1]
}
