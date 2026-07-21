'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { composeFromSeedAction } from '@/app/actions/compose-seed'

const MAX_HEADLINE = 240
const MAX_BODY = 800
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'

export function ComposeNewForm() {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)

  const [headlineHint, setHeadlineHint] = useState('')
  const [bodyHint, setBodyHint] = useState('')
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageName, setImageName] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function onImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) {
      setImagePreview(null)
      setImageName(null)
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setMsg({ kind: 'err', text: `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — max 8 MB.` })
      e.target.value = ''
      return
    }
    setMsg(null)
    setImageName(file.name)
    const reader = new FileReader()
    reader.onload = () => setImagePreview(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(file)
  }

  function clearImage() {
    setImagePreview(null)
    setImageName(null)
    const input = formRef.current?.elements.namedItem('image') as HTMLInputElement | null
    if (input) input.value = ''
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!headlineHint.trim() && !bodyHint.trim()) {
      setMsg({ kind: 'err', text: 'Add at least a headline hint or a body hint.' })
      return
    }
    setMsg(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const r = await composeFromSeedAction(formData)
      if ('error' in r) {
        setMsg({ kind: 'err', text: r.error })
        return
      }
      // Redirect straight into the standard compose refinement view for this new draft.
      router.push(`/compose?slot=${r.slotId}`)
    })
  }

  const canSubmit = (headlineHint.trim().length > 0 || bodyHint.trim().length > 0) && !pending

  return (
    <>
      <div className="box pad-lg mb16">
        <div className="row between center wrap gap12">
          <div className="stack gap6">
            <span className="eyebrow">Write from scratch</span>
            <div style={{ fontSize: 17, fontWeight: 700 }}>Give me your seed — I&apos;ll turn it into a full post</div>
            <div className="note">
              Drop a rough headline and a couple of lines of body. Add your own image if you have one.
              AI expands it into a polished LinkedIn post using your voice, your playbook, and what
              already performs in your niche — then schedules it on your calendar.
            </div>
          </div>
          <Link className="btn ghost sm" href="/ideas">Back to ideas</Link>
        </div>
      </div>

      {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'err'} mb16`}>{msg.text}</div>}

      <form ref={formRef} onSubmit={onSubmit}>
        <div className="g2" style={{ alignItems: 'start' }}>
          {/* LEFT: seed inputs */}
          <div className="box pad-lg">
            <div className="row between center" style={{ marginBottom: 12 }}>
              <div className="h-sec">Your seed</div>
              <span className="tag human"><span className="dot" />you write this</span>
            </div>

            <label className="eyebrow" htmlFor="headlineHint">Headline hint (the point you want to open with)</label>
            <textarea
              id="headlineHint"
              name="headlineHint"
              className="field"
              style={{ minHeight: 70, lineHeight: 1.5, marginTop: 6 }}
              placeholder="e.g. Everyone says AI will replace engineers. My last 3 months tell a different story."
              value={headlineHint}
              maxLength={MAX_HEADLINE}
              onChange={(e) => setHeadlineHint(e.target.value)}
              disabled={pending}
            />
            <div className="row between center mt6">
              <span className="eyebrow">Keep it short — 1-2 lines. AI will sharpen it.</span>
              <span className="eyebrow">{headlineHint.length} / {MAX_HEADLINE}</span>
            </div>

            <div style={{ height: 16 }} />

            <label className="eyebrow" htmlFor="bodyHint">Body hint (the specific point you want to make)</label>
            <textarea
              id="bodyHint"
              name="bodyHint"
              className="field"
              style={{ minHeight: 140, lineHeight: 1.6, marginTop: 6 }}
              placeholder="e.g. I shipped a whole side project on my own. Not because I'm a great engineer — because AI let me move at 3x the speed on the boring parts. That's not replacement, that's leverage."
              value={bodyHint}
              maxLength={MAX_BODY}
              onChange={(e) => setBodyHint(e.target.value)}
              disabled={pending}
            />
            <div className="row between center mt6">
              <span className="eyebrow">A couple of lines is enough. AI expands around your point — it won&apos;t invent facts.</span>
              <span className="eyebrow">{bodyHint.length} / {MAX_BODY}</span>
            </div>
          </div>

          {/* RIGHT: image + submit */}
          <div className="box pad-lg">
            <div className="row between center" style={{ marginBottom: 12 }}>
              <div className="h-sec">Your image (optional)</div>
              <span className="tag human"><span className="dot" />you upload</span>
            </div>
            <div className="note" style={{ marginBottom: 12 }}>
              Attach your own photo/graphic. If you skip this, AI writes a detailed image prompt
              you can generate later in Compose.
            </div>

            <input
              type="file"
              name="image"
              accept={IMAGE_ACCEPT}
              onChange={onImageChange}
              disabled={pending}
              style={{ display: 'block', fontSize: 13 }}
            />
            <div className="eyebrow mt6">JPG, PNG, WEBP or GIF. Max 8 MB.</div>

            {imagePreview && (
              <div className="mt16">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreview}
                  alt="Selected"
                  style={{ width: '100%', borderRadius: 6, border: '1px solid var(--line)', display: 'block' }}
                />
                <div className="row between center mt8">
                  <span className="eyebrow" title={imageName ?? ''}>{imageName}</span>
                  <button type="button" className="btn ghost sm" onClick={clearImage} disabled={pending}>
                    Remove
                  </button>
                </div>
              </div>
            )}

            <div className="divider" style={{ margin: '20px 0' }} />

            <button type="submit" className="btn primary" style={{ width: '100%' }} disabled={!canSubmit}>
              {pending ? 'Composing…' : 'Generate full post'}
            </button>
            <div className="eyebrow mt8" style={{ textAlign: 'center' }}>
              {pending
                ? 'AI is writing your post and picking the best slot on your calendar…'
                : 'Uses Claude/Gemini (your configured provider). Auto-schedules to your best-performing window.'}
            </div>
          </div>
        </div>
      </form>
    </>
  )
}
