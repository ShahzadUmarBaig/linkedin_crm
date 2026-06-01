'use client'

import { useState, useTransition } from 'react'
import {
  markSlotPostedAction,
  rescheduleSlotAction,
  skipSlotAction,
  updateDraftBodyAction,
} from '@/app/actions/calendar'
import type { CalendarSlotView } from '@/lib/calendar'

interface Props {
  upcoming: CalendarSlotView[]
  posted: CalendarSlotView[]
  skipped: CalendarSlotView[]
}

export function CalendarList({ upcoming, posted, skipped }: Props) {
  const [showPosted, setShowPosted] = useState(false)
  const [showSkipped, setShowSkipped] = useState(false)

  return (
    <div className="space-y-6">
      <Stats upcoming={upcoming.length} posted={posted.length} skipped={skipped.length} />

      {upcoming.length === 0 ? (
        <EmptyState />
      ) : (
        <Section title="Upcoming">
          {upcoming.map((s) => (
            <SlotCard key={s.slot_id} slot={s} />
          ))}
        </Section>
      )}

      <Toggle on={showPosted} setOn={setShowPosted} label={`Posted (${posted.length})`} />
      {showPosted && posted.length > 0 && (
        <Section>
          {posted.map((s) => (
            <SlotCard key={s.slot_id} slot={s} readonly />
          ))}
        </Section>
      )}

      <Toggle on={showSkipped} setOn={setShowSkipped} label={`Skipped (${skipped.length})`} />
      {showSkipped && skipped.length > 0 && (
        <Section>
          {skipped.map((s) => (
            <SlotCard key={s.slot_id} slot={s} readonly />
          ))}
        </Section>
      )}
    </div>
  )
}

function Stats({ upcoming, posted, skipped }: { upcoming: number; posted: number; skipped: number }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Stat label="Scheduled" value={upcoming} />
      <Stat label="Posted" value={posted} />
      <Stat label="Skipped" value={skipped} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
      Nothing scheduled. Approve an idea on <span className="font-medium">/ideas</span> to get a draft and a calendar slot.
    </div>
  )
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section>
      {title && <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>}
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Toggle({ on, setOn, label }: { on: boolean; setOn: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      className="block text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
    >
      {on ? 'Hide' : 'Show'} {label}
    </button>
  )
}

function SlotCard({ slot, readonly }: { slot: CalendarSlotView; readonly?: boolean }) {
  const [editingBody, setEditingBody] = useState(false)
  const [body, setBody] = useState(slot.draft_body ?? '')
  const [rescheduling, setRescheduling] = useState(false)
  const [newWhen, setNewWhen] = useState(toLocalInput(slot.scheduled_for))
  const [busy, startBusy] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  function clear() {
    setErr(null)
    setOk(null)
  }

  function saveBody() {
    clear()
    if (!slot.draft_id) return
    startBusy(async () => {
      const r = await updateDraftBodyAction(slot.draft_id!, body)
      if (r.error) setErr(r.error)
      else {
        setOk('Saved.')
        setEditingBody(false)
      }
    })
  }

  function copyBody() {
    if (!slot.draft_body) return
    void navigator.clipboard.writeText(slot.draft_body)
    setOk('Copied to clipboard.')
  }

  function markPosted() {
    clear()
    startBusy(async () => {
      const r = await markSlotPostedAction(slot.slot_id)
      if (r.error) setErr(r.error)
      else setOk('Marked as posted.')
    })
  }

  function skip() {
    clear()
    if (!confirm('Skip this slot? The draft stays around but disappears from upcoming.')) return
    startBusy(async () => {
      const r = await skipSlotAction(slot.slot_id)
      if (r.error) setErr(r.error)
      else setOk('Skipped.')
    })
  }

  function reschedule() {
    clear()
    const iso = fromLocalInput(newWhen)
    if (!iso) {
      setErr('Invalid date/time.')
      return
    }
    startBusy(async () => {
      const r = await rescheduleSlotAction(slot.slot_id, iso)
      if (r.error) setErr(r.error)
      else {
        setOk('Rescheduled.')
        setRescheduling(false)
      }
    })
  }

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{formatDate(slot.scheduled_for)}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            {slot.idea_pillar && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">{slot.idea_pillar}</span>
            )}
            <span>{slot.ai_chosen ? 'AI-scheduled' : 'Manually scheduled'}</span>
            {slot.status === 'posted' && slot.posted_at && (
              <span className="text-green-700 dark:text-green-300">posted {formatDate(slot.posted_at)}</span>
            )}
          </div>
        </div>
      </div>

      {slot.ai_reasoning && (
        <p className="mb-3 text-xs italic text-zinc-500">{slot.ai_reasoning}</p>
      )}

      {editingBody ? (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={Math.max(6, body.split('\n').length + 1)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-sans text-sm leading-relaxed dark:border-zinc-700 dark:bg-zinc-950"
        />
      ) : (
        <div className="whitespace-pre-wrap rounded-md bg-zinc-50 p-3 text-sm leading-relaxed dark:bg-zinc-950">
          {slot.draft_body ?? '(no body)'}
        </div>
      )}

      {err && <p className="mt-2 text-xs text-red-700 dark:text-red-300">{err}</p>}
      {ok && <p className="mt-2 text-xs text-green-700 dark:text-green-300">{ok}</p>}

      {rescheduling && !readonly && (
        <div className="mt-3 flex gap-2">
          <input
            type="datetime-local"
            value={newWhen}
            onChange={(e) => setNewWhen(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          <button
            type="button"
            onClick={reschedule}
            disabled={busy}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setRescheduling(false)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      )}

      {!readonly && !rescheduling && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={markPosted}
            disabled={busy}
            className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Mark as posted
          </button>
          <button
            type="button"
            onClick={copyBody}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Copy body
          </button>
          {editingBody ? (
            <>
              <button
                type="button"
                onClick={saveBody}
                disabled={busy}
                className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Save body
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingBody(false)
                  setBody(slot.draft_body ?? '')
                }}
                className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditingBody(true)}
              className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Edit body
            </button>
          )}
          <button
            type="button"
            onClick={() => setRescheduling(true)}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Reschedule
          </button>
          <button
            type="button"
            onClick={skip}
            disabled={busy}
            className="ml-auto rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Skip
          </button>
        </div>
      )}
    </article>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// HTML <input type="datetime-local"> uses local time without a timezone. Convert to/from ISO.
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}
