'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { updateDraftBodyAction } from '@/app/actions/calendar'
import type { CalendarSlotView } from '@/lib/calendar'
import { formatDateTime } from '@/lib/format'

const MAX = 3000

export function ComposeView({ view }: { view: CalendarSlotView }) {
  const router = useRouter()
  const [body, setBody] = useState(view.draft_body ?? '')
  const [dirty, setDirty] = useState(false)
  const [saving, startSave] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function save() {
    if (!view.draft_id) return
    setMsg(null)
    startSave(async () => {
      const r = await updateDraftBodyAction(view.draft_id!, body)
      if (r.error) return setMsg({ kind: 'err', text: r.error })
      setDirty(false)
      setMsg({ kind: 'ok', text: 'Saved.' })
    })
  }

  function copy() {
    void navigator.clipboard.writeText(body)
    setMsg({ kind: 'ok', text: 'Copied to clipboard.' })
  }

  return (
    <>
      {/* header + stepper */}
      <div className="box pad-lg mb16">
        <div className="row between center wrap gap12">
          <div className="stack gap6">
            <span className="eyebrow">Approved idea → AI prepared everything</span>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{view.idea_hook ?? 'Draft post'}</div>
          </div>
          <div className="stepper">
            <div className="s done"><span className="n">✓</span>Write</div>
            <span className="sep" />
            <div className="s on"><span className="n">2</span>Visual</div>
            <span className="sep" />
            <div className="s"><span className="n">3</span>Approve</div>
          </div>
        </div>
      </div>

      {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'err'} mb16`}>{msg.text}</div>}

      <div className="g2" style={{ alignItems: 'start' }}>
        {/* LEFT: draft text */}
        <div className="box pad-lg">
          <div className="row between center" style={{ marginBottom: 12 }}>
            <div className="h-sec">Draft text</div>
            <span className="tag auto"><span className="dot" />AI generated</span>
          </div>
          <textarea
            className="field"
            style={{ minHeight: 280, lineHeight: 1.6 }}
            value={body}
            maxLength={MAX}
            onChange={(e) => {
              setBody(e.target.value)
              setDirty(true)
            }}
          />
          <div className="row between center mt12">
            <div className="row gap6">
              <button className="btn primary sm" onClick={save} disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save edits'}
              </button>
              <button className="btn ghost sm" onClick={copy}>Copy</button>
            </div>
            <span className="eyebrow">{body.length} / {MAX}</span>
          </div>
          <div className="note mt12">
            Edit inline — AI just gives you the starting draft. Changes save to the calendar entry.
          </div>
        </div>

        {/* RIGHT: visual (stub) */}
        <div className="box pad-lg">
          <div className="row between center" style={{ marginBottom: 12 }}>
            <div className="h-sec">Visual</div>
            <span className="tag"><span className="dot" />coming soon</span>
          </div>
          <span className="eyebrow">Auto-suggested prompt — edit before generating</span>
          <div className="box mt8" style={{ background: 'var(--panel-2)', padding: 12 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontFamily: 'var(--mono)', lineHeight: 1.5, color: 'var(--ink)' }}>
              Minimal 3D illustration on a muted blue accent with lots of negative space, reflecting
              the post&apos;s theme.
            </p>
          </div>
          <div className="row gap6 mt12">
            <button className="btn primary sm" disabled title="AI image generation isn't wired up yet">
              <span className="ico" />Generate 4
            </button>
            <button className="btn ghost sm" disabled>Upload instead</button>
          </div>
          <div className="g2 mt16" style={{ gap: 10 }}>
            <div className="imgph" style={{ height: 104 }}>VISUAL · soon</div>
            <div className="imgph" style={{ height: 104 }}>VISUAL · soon</div>
            <div className="imgph" style={{ height: 104 }}>VISUAL · soon</div>
            <div className="imgph" style={{ height: 104 }}>VISUAL · soon</div>
          </div>
          <div className="note mt16">
            AI image generation (“nano banana”) isn&apos;t live yet. For now, post text-only or attach
            your own image on LinkedIn.
          </div>
        </div>
      </div>

      {/* review + approve */}
      <div className="box pad-lg mt16">
        <div className="row between center" style={{ marginBottom: 14 }}>
          <div className="h-sec">Step 3 · Review &amp; approve</div>
          <span className="tag human"><span className="dot" />your decision</span>
        </div>
        <div className="g-main">
          {/* preview */}
          <div className="li-card">
            <div className="hd">
              <div className="avatar">Y</div>
              <div className="stack" style={{ gap: 3 }}>
                <b style={{ fontSize: 13 }}>You</b>
                <span style={{ fontSize: 11, color: 'var(--faint)' }}>now · 🌐</span>
              </div>
            </div>
            <div className="body">
              {body.trim() ? (
                body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)
              ) : (
                <p style={{ color: 'var(--faint)' }}>Your post text appears here…</p>
              )}
            </div>
            <div className="li-actions">
              <span>👍 Like</span><span>💬 Comment</span><span>↻ Repost</span><span>➤ Send</span>
            </div>
          </div>

          {/* approve actions */}
          <div className="stack gap12">
            <div className="note">
              This draft is already on your <b>calendar</b> at its AI-chosen slot. Tweak the text here,
              then post it manually when its time comes.
            </div>
            <div className="box pad" style={{ background: 'var(--panel-2)' }}>
              <div className="row between center">
                <span className="eyebrow">Scheduled for</span>
                <span className="tag human"><span className="dot" />{formatDateTime(view.scheduled_for)}</span>
              </div>
              {view.ai_reasoning && (
                <>
                  <div className="divider" style={{ margin: '10px 0' }} />
                  <div className="row between center gap8">
                    <span className="eyebrow">Why this slot</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right' }}>{view.ai_reasoning}</span>
                  </div>
                </>
              )}
            </div>
            <Link className="btn human" style={{ padding: 12, fontSize: 14 }} href="/calendar">
              ✓ Looks good — view calendar
            </Link>
            <div className="row gap8">
              {dirty && (
                <button className="btn ghost grow" onClick={save} disabled={saving}>Save edits</button>
              )}
              <button className="btn ghost grow" onClick={() => router.push('/ideas')}>Back to ideas</button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
