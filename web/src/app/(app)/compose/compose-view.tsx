'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { regenerateDraftAction, regenerateImagePromptAction, rescheduleSlotAction, updateDraftBodyAction } from '@/app/actions/calendar'
import { generateImagesAction, selectImageAction } from '@/app/actions/images'
import type { CalendarSlotView } from '@/lib/calendar'
import { formatDate, formatDateTime, truncate } from '@/lib/format'
import { PublishFlow } from '../publish-flow'

const MAX = 3000
const FALLBACK_IMAGE_PROMPT =
  'No image prompt yet — regenerate this draft (or approve a fresh idea) to get a detailed prompt.'

interface DraftRef {
  slot_id: string
  idea_hook: string | null
  scheduled_for: string
}

export function ComposeView({ view, drafts = [] }: { view: CalendarSlotView; drafts?: DraftRef[] }) {
  const router = useRouter()
  const [body, setBody] = useState(view.draft_body ?? '')
  const [dirty, setDirty] = useState(false)
  const [saving, startSave] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const [imagePrompt, setImagePrompt] = useState(view.draft_image_prompt ?? '')
  const [images, setImages] = useState<string[]>(view.draft_image_urls ?? [])
  const [selectedImage, setSelectedImage] = useState<string | null>(view.draft_selected_image_url ?? null)
  const [genImg, startGenImg] = useTransition()
  const [genPrompt, startGenPrompt] = useTransition()
  const [rescheduling, setRescheduling] = useState(false)
  const [when, setWhen] = useState(toLocalInput(view.scheduled_for))
  const [busy, startBusy] = useTransition()

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

  function copyImagePrompt() {
    void navigator.clipboard.writeText(imagePrompt)
    setMsg({ kind: 'ok', text: 'Image prompt copied.' })
  }

  function generateImages() {
    if (!view.draft_id) return
    setMsg(null)
    startGenImg(async () => {
      const r = await generateImagesAction(view.draft_id!, imagePrompt)
      if ('error' in r) return setMsg({ kind: 'err', text: r.error })
      setImages(r.urls)
      setSelectedImage(r.urls[0] ?? null)
      setMsg({ kind: 'ok', text: 'Image generated.' })
    })
  }

  function pickImage(url: string) {
    setSelectedImage(url)
    if (view.draft_id) void selectImageAction(view.draft_id, url)
  }

  // Re-run ONLY the image prompt through the current (improved) generator —
  // leaves the post body untouched. Good for older drafts with abstract prompts.
  function regenerateImagePrompt() {
    if (!view.draft_id) return
    setMsg(null)
    startGenPrompt(async () => {
      const r = await regenerateImagePromptAction(view.draft_id!)
      if ('error' in r) return setMsg({ kind: 'err', text: r.error })
      setImagePrompt(r.imagePrompt)
      setMsg({ kind: 'ok', text: 'New image prompt generated — review it, then Generate image.' })
    })
  }

  function regenerate() {
    if (!view.draft_id) return
    setMsg(null)
    startBusy(async () => {
      const r = await regenerateDraftAction(view.draft_id!)
      if ('error' in r) return setMsg({ kind: 'err', text: r.error })
      setBody(r.body)
      setImagePrompt(r.imagePrompt ?? '')
      setDirty(false)
      setMsg({ kind: 'ok', text: 'Regenerated with hashtags + detailed image prompt.' })
    })
  }

  function reschedule() {
    const iso = fromLocalInput(when)
    if (!iso) return setMsg({ kind: 'err', text: 'Invalid date/time.' })
    setMsg(null)
    startBusy(async () => {
      const r = await rescheduleSlotAction(view.slot_id, iso)
      if (r.error) return setMsg({ kind: 'err', text: r.error })
      setRescheduling(false)
      setMsg({ kind: 'ok', text: 'Rescheduled.' })
      router.refresh()
    })
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

        {drafts.length > 1 && (
          <>
            <div className="divider" />
            <div className="row gap8 wrap center">
              <span className="eyebrow">Your drafts:</span>
              {drafts.map((d) => {
                const active = d.slot_id === view.slot_id
                return (
                  <Link
                    key={d.slot_id}
                    href={`/compose?slot=${d.slot_id}`}
                    className={`chip${active ? '' : ''}`}
                    style={active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                    title={d.idea_hook ?? ''}
                  >
                    {d.idea_hook ? truncate(d.idea_hook, 36) : 'Draft'} · {formatDate(d.scheduled_for)}
                  </Link>
                )
              })}
            </div>
          </>
        )}
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
              <button className="btn ghost sm" onClick={regenerate} disabled={busy} title="Re-run the AI with hashtags + image prompt">
                {busy ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
            <span className="eyebrow">{body.length} / {MAX}</span>
          </div>
          <div className="note mt12">
            Edit inline — AI just gives you the starting draft. Changes save to the calendar entry.
          </div>
        </div>

        {/* RIGHT: visual */}
        <div className="box pad-lg">
          <div className="row between center" style={{ marginBottom: 12 }}>
            <div className="h-sec">Visual</div>
            <span className="tag auto"><span className="dot" />FLUX.2 pro</span>
          </div>
          <div className="row between center" style={{ marginBottom: 6 }}>
            <span className="eyebrow">Image prompt — edit before generating</span>
            <span className="eyebrow">{wordCount(imagePrompt)} words</span>
          </div>
          <textarea
            className="field mono"
            style={{ minHeight: 200, fontSize: 12, lineHeight: 1.55 }}
            value={imagePrompt}
            placeholder={FALLBACK_IMAGE_PROMPT}
            onChange={(e) => setImagePrompt(e.target.value)}
          />
          <div className="row gap6 mt12 wrap">
            <button className="btn primary sm" onClick={generateImages} disabled={genImg || genPrompt || !imagePrompt.trim()}>
              <span className="ico" />{genImg ? 'Generating…' : images.length ? 'Regenerate' : 'Generate image'}
            </button>
            <button
              className="btn ghost sm"
              onClick={regenerateImagePrompt}
              disabled={genPrompt || genImg || !view.draft_id}
              title="Rewrite the image prompt with the latest concrete-visual generator (leaves your post text unchanged)"
            >
              {genPrompt ? 'Rewriting…' : 'Regenerate prompt'}
            </button>
            <button className="btn ghost sm" onClick={copyImagePrompt} disabled={!imagePrompt.trim()}>Copy prompt</button>
          </div>
          <div className="mt16">
            {images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={images[0]}
                alt="Generated visual"
                style={{ width: '100%', borderRadius: 6, border: '1px solid var(--line)', display: 'block' }}
              />
            ) : (
              <div className="imgph" style={{ height: 200 }}>{genImg ? 'Generating…' : 'VISUAL'}</div>
            )}
          </div>
          <div className="note mt16">
            {images[0]
              ? 'This image is attached — it downloads when you publish. Edit the prompt and Regenerate for a different take.'
              : 'Generates one image with FLUX.2 [pro] (fal.ai). Needs FALAIKEY configured.'}
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
            {selectedImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedImage} alt="" style={{ width: '100%', display: 'block', borderTop: '1px solid var(--line)' }} />
            )}
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
              <div className="row between center gap8">
                <span className="eyebrow">Scheduled for</span>
                <div className="row gap8 center">
                  <span className="tag human"><span className="dot" />{formatDateTime(view.scheduled_for)}</span>
                  {!rescheduling && (
                    <button className="btn ghost sm" onClick={() => setRescheduling(true)}>Reschedule</button>
                  )}
                </div>
              </div>
              {rescheduling && (
                <div className="row gap8 mt12 wrap">
                  <input type="datetime-local" className="field" style={{ width: 'auto', flex: 1 }} value={when} onChange={(e) => setWhen(e.target.value)} />
                  <button className="btn primary sm" onClick={reschedule} disabled={busy}>{busy ? 'Saving…' : 'Save time'}</button>
                  <button className="btn ghost sm" onClick={() => setRescheduling(false)}>Cancel</button>
                </div>
              )}
              {view.ai_reasoning && !rescheduling && (
                <>
                  <div className="divider" style={{ margin: '10px 0' }} />
                  <div className="row between center gap8">
                    <span className="eyebrow">Why this slot</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right' }}>{view.ai_reasoning}</span>
                  </div>
                </>
              )}
            </div>
            {dirty && (
              <div className="note">Save your edits before publishing so the copied caption matches.</div>
            )}
            <PublishFlow slotId={view.slot_id} caption={body} images={selectedImage ? [selectedImage] : []} />
            <div className="row gap8">
              {dirty && (
                <button className="btn ghost grow" onClick={save} disabled={saving}>Save edits</button>
              )}
              <Link className="btn ghost grow" href="/calendar" style={{ textAlign: 'center' }}>View calendar</Link>
              <button className="btn ghost grow" onClick={() => router.push('/ideas')}>Back to ideas</button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function wordCount(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).length : 0
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
