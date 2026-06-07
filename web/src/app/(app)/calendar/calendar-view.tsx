'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  rescheduleSlotAction,
  skipSlotAction,
  updateDraftBodyAction,
} from '@/app/actions/calendar'
import type { CalendarSlotView } from '@/lib/calendar'
import { formatDateTime } from '@/lib/format'
import { PublishFlow } from '../publish-flow'

type View = 'month' | 'list'

interface Props {
  upcoming: CalendarSlotView[]
  posted: CalendarSlotView[]
  skipped: CalendarSlotView[]
}

function slotClass(s: CalendarSlotView): 'posted' | 'draft' | 'you' | 'sched' {
  if (s.status === 'posted') return 'posted'
  if (s.status === 'skipped') return 'draft'
  return new Date(s.scheduled_for).getTime() <= Date.now() ? 'you' : 'sched'
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function CalendarView({ upcoming, posted, skipped }: Props) {
  const [view, setView] = useState<View>('month')
  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const all = useMemo(() => [...upcoming, ...posted, ...skipped], [upcoming, posted, skipped])
  const due = upcoming.filter((s) => new Date(s.scheduled_for).getTime() <= Date.now())
  const selected = all.find((s) => s.slot_id === selectedId) ?? null

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarSlotView[]>()
    for (const s of all) {
      const k = dateKey(new Date(s.scheduled_for))
      const arr = map.get(k) ?? []
      arr.push(s)
      map.set(k, arr)
    }
    return map
  }, [all])

  const base = new Date()
  base.setDate(1)
  base.setMonth(base.getMonth() + monthOffset)
  const year = base.getFullYear()
  const month = base.getMonth()
  const monthLabel = base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const weeks = useMemo(() => buildWeeks(year, month), [year, month])
  const todayKey = dateKey(new Date())

  return (
    <>
      <div className="box pad-lg mb16">
        <div className="row between center wrap gap12">
          <div className="stack gap6">
            <span className="eyebrow">Auto-scheduled by the engine</span>
            <div className="h-page">Your content calendar</div>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              Approved posts land here automatically. Your job: post each one manually at its time.
            </span>
          </div>
          <div className="vtabs">
            <button className={`vtab${view === 'month' ? ' active' : ''}`} onClick={() => setView('month')}>Month</button>
            <button className={`vtab${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')}>List</button>
          </div>
        </div>
        <div className="legend mt16">
          <span><i style={{ background: 'var(--human-soft)', borderColor: 'var(--human-line)' }} />ready — you post</span>
          <span><i style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }} />scheduled</span>
          <span><i style={{ background: 'var(--good-soft)', borderColor: 'var(--good-line)' }} />posted</span>
          <span><i style={{ background: 'var(--panel-2)', borderColor: 'var(--line)' }} />skipped</span>
        </div>
      </div>

      {all.length === 0 ? (
        <div className="box pad-lg" style={{ textAlign: 'center' }}>
          <div className="note" style={{ display: 'inline-block' }}>
            Nothing scheduled. Approve an idea on the <b>Ideas</b> screen to get a draft and a calendar slot.
          </div>
        </div>
      ) : view === 'month' ? (
        <div className="g-main" style={{ alignItems: 'start' }}>
          <div className="box pad-lg">
            <div className="row between center" style={{ marginBottom: 12 }}>
              <div className="h-sec">{monthLabel}</div>
              <div className="row gap6">
                <button className="btn ghost sm" onClick={() => setMonthOffset((o) => o - 1)}>‹</button>
                <button className="btn ghost sm" onClick={() => setMonthOffset(0)}>Today</button>
                <button className="btn ghost sm" onClick={() => setMonthOffset((o) => o + 1)}>›</button>
              </div>
            </div>
            <div className="cal" style={{ marginBottom: 6 }}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div className="dow" key={d}>{d}</div>
              ))}
            </div>
            <div className="cal">
              {weeks.flat().map(({ date, inMonth }) => {
                const k = dateKey(date)
                const evs = eventsByDay.get(k) ?? []
                return (
                  <div className={`day${inMonth ? '' : ' dim'}${k === todayKey ? ' today' : ''}`} key={k}>
                    <span className="dn">{date.getDate()}</span>
                    {evs.map((s) => {
                      const cls = slotClass(s)
                      const time = new Date(s.scheduled_for).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                      const label =
                        cls === 'you' ? `${time} · POST NOW` :
                        cls === 'posted' ? `${time} · posted ✓` :
                        cls === 'sched' ? `${time} · scheduled` : `${time} · skipped`
                      return (
                        <button
                          key={s.slot_id}
                          className={`ev ${cls}`}
                          onClick={() => setSelectedId(s.slot_id)}
                          title={s.idea_hook ?? ''}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="stack gap16">
            {due.length > 0 && (
              <div className="box pad-lg">
                <div className="h-sec" style={{ marginBottom: 10 }}>Ready to post</div>
                <div className="stack gap12">
                  {due.map((s) => (
                    <div className="todo" key={s.slot_id} style={{ borderColor: 'var(--human-line)', borderRadius: 9, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                      <div className="row between center gap8">
                        <div className="stack gap6">
                          <b style={{ fontSize: 12.5 }}>{s.idea_hook ?? 'Scheduled post'}</b>
                          <span className="tag human"><span className="dot" />{formatDateTime(s.scheduled_for)}</span>
                        </div>
                        <Link className="btn ghost sm" href={`/compose?slot=${s.slot_id}`}>Edit →</Link>
                      </div>
                      <PublishFlow slotId={s.slot_id} caption={s.draft_body ?? ''} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selected ? (
              <SlotDetail slot={selected} onClose={() => setSelectedId(null)} />
            ) : (
              <div className="box pad-lg">
                <div className="h-sec" style={{ marginBottom: 10 }}>Posting cadence</div>
                <div className="note">Click any event to edit it, reschedule, or mark it posted.</div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <ListView upcoming={upcoming} posted={posted} skipped={skipped} />
      )}
    </>
  )
}

function SlotDetail({ slot, onClose }: { slot: CalendarSlotView; onClose: () => void }) {
  const router = useRouter()
  const [body, setBody] = useState(slot.draft_body ?? '')
  const [editing, setEditing] = useState(false)
  const [when, setWhen] = useState(toLocalInput(slot.scheduled_for))
  const [rescheduling, setRescheduling] = useState(false)
  const [busy, startBusy] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const readonly = slot.status !== 'scheduled'

  const run = (fn: () => Promise<{ error?: string }>, okText: string) => {
    setMsg(null)
    startBusy(async () => {
      const r = await fn()
      if (r.error) return setMsg({ kind: 'err', text: r.error })
      setMsg({ kind: 'ok', text: okText })
      router.refresh()
    })
  }

  return (
    <div className="box pad-lg">
      <div className="row between center" style={{ marginBottom: 10 }}>
        <div className="h-sec">{formatDateTime(slot.scheduled_for)}</div>
        <button className="btn ghost sm" onClick={onClose}>✕</button>
      </div>
      <div className="meta-row" style={{ marginBottom: 10 }}>
        {slot.idea_pillar && <span className="tag"><span className="dot" />{slot.idea_pillar}</span>}
        <span className={`tag ${slot.status === 'posted' ? 'good' : slot.status === 'skipped' ? '' : 'sched'}`}>
          <span className="dot" />{slot.status}
        </span>
        <span className="tag auto"><span className="dot" />{slot.ai_chosen ? 'AI-scheduled' : 'manual'}</span>
      </div>
      {!readonly && (
        <Link className="btn primary sm" href={`/compose?slot=${slot.slot_id}`} style={{ width: '100%', marginBottom: 10 }}>
          Open in Compose (full editor) →
        </Link>
      )}
      {slot.ai_reasoning && <p className="note" style={{ marginBottom: 10 }}>{slot.ai_reasoning}</p>}

      {editing && !readonly ? (
        <textarea className="field" style={{ minHeight: 180 }} value={body} onChange={(e) => setBody(e.target.value)} />
      ) : (
        <div className="box" style={{ background: 'var(--panel-2)', padding: 12, whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.55 }}>
          {slot.draft_body ?? '(no body)'}
        </div>
      )}

      {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'err'} mt12`}>{msg.text}</div>}

      {rescheduling && !readonly && (
        <div className="row gap8 mt12">
          <input type="datetime-local" className="field" value={when} onChange={(e) => setWhen(e.target.value)} />
          <button
            className="btn primary sm"
            disabled={busy}
            onClick={() => {
              const iso = fromLocalInput(when)
              if (!iso) return setMsg({ kind: 'err', text: 'Invalid date.' })
              run(() => rescheduleSlotAction(slot.slot_id, iso), 'Rescheduled.')
              setRescheduling(false)
            }}
          >
            Save
          </button>
          <button className="btn ghost sm" onClick={() => setRescheduling(false)}>Cancel</button>
        </div>
      )}

      {!readonly && !rescheduling && (
        <div className="mt16">
          <PublishFlow slotId={slot.slot_id} caption={editing ? body : slot.draft_body ?? ''} />
        </div>
      )}

      {!readonly && !rescheduling && (
        <div className="row gap6 wrap mt12">
          {editing ? (
            <button className="btn primary sm" disabled={busy || !slot.draft_id} onClick={() => { run(() => updateDraftBodyAction(slot.draft_id!, body), 'Saved.'); setEditing(false) }}>
              Save body
            </button>
          ) : (
            <button className="btn ghost sm" onClick={() => setEditing(true)}>Edit body</button>
          )}
          <button className="btn ghost sm" onClick={() => setRescheduling(true)}>Reschedule</button>
          <button className="btn danger sm" disabled={busy} onClick={() => run(() => skipSlotAction(slot.slot_id), 'Skipped.')} style={{ marginLeft: 'auto' }}>
            Skip
          </button>
        </div>
      )}
    </div>
  )
}

function ListView({ upcoming, posted, skipped }: Props) {
  const [showPosted, setShowPosted] = useState(false)
  const [showSkipped, setShowSkipped] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const Row = ({ s }: { s: CalendarSlotView }) => (
    <div>
      <div className="todo" style={{ borderRadius: 9, cursor: 'pointer' }} onClick={() => setOpenId(openId === s.slot_id ? null : s.slot_id)}>
        <div className="grow stack gap6">
          <b style={{ fontSize: 13 }}>{s.idea_hook ?? 'Scheduled post'}</b>
          <div className="meta-row">
            <span className={`tag ${slotClass(s) === 'you' ? 'human' : slotClass(s)}`}><span className="dot" />{formatDateTime(s.scheduled_for)}</span>
            {s.idea_pillar && <span className="tag"><span className="dot" />{s.idea_pillar}</span>}
          </div>
        </div>
        <span className="btn ghost sm">{openId === s.slot_id ? 'Hide' : 'Open'}</span>
      </div>
      {openId === s.slot_id && <div className="mt12"><SlotDetail slot={s} onClose={() => setOpenId(null)} /></div>}
    </div>
  )

  return (
    <div className="stack gap16">
      {upcoming.length === 0 ? (
        <div className="note">Nothing upcoming.</div>
      ) : (
        <div className="stack gap12">
          {upcoming.map((s) => <Row key={s.slot_id} s={s} />)}
        </div>
      )}

      <button className="vtab" onClick={() => setShowPosted((v) => !v)}>{showPosted ? 'Hide' : 'Show'} posted ({posted.length})</button>
      {showPosted && <div className="stack gap12">{posted.map((s) => <Row key={s.slot_id} s={s} />)}</div>}

      <button className="vtab" onClick={() => setShowSkipped((v) => !v)}>{showSkipped ? 'Hide' : 'Show'} skipped ({skipped.length})</button>
      {showSkipped && <div className="stack gap12">{skipped.map((s) => <Row key={s.slot_id} s={s} />)}</div>}
    </div>
  )
}

// ----- date helpers -----
function buildWeeks(year: number, month: number): { date: Date; inMonth: boolean }[][] {
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + 6) % 7 // Monday-first
  const start = new Date(year, month, 1 - startOffset)
  const weeks: { date: Date; inMonth: boolean }[][] = []
  const cursor = new Date(start)
  for (let w = 0; w < 6; w++) {
    const week: { date: Date; inMonth: boolean }[] = []
    for (let d = 0; d < 7; d++) {
      week.push({ date: new Date(cursor), inMonth: cursor.getMonth() === month })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
    // Stop after we've passed the month and completed a week.
    if (cursor.getMonth() !== month && week[6].date.getMonth() !== month && w >= 4) break
  }
  return weeks
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
