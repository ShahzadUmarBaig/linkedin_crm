'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markSlotPostedAction } from '@/app/actions/calendar'

// LinkedIn has no API to pre-fill post text, so the smoothest path is: copy the caption,
// open LinkedIn's "Start a post" composer in a new tab, the user pastes (⌘/Ctrl-V) + posts,
// then marks it posted here so the next scrape can correlate performance.
const LINKEDIN_COMPOSER = 'https://www.linkedin.com/feed/?shareActive=true'

export function PublishFlow({
  slotId,
  caption,
  images = [],
}: {
  slotId: string
  caption: string
  images?: string[]
}) {
  const router = useRouter()
  const [opened, setOpened] = useState(false)
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function copyAndOpen() {
    void navigator.clipboard.writeText(caption)
    images.forEach((src, i) => downloadImage(src, `post-image-${i + 1}`))
    window.open(LINKEDIN_COMPOSER, '_blank', 'noopener')
    setOpened(true)
    setMsg({
      kind: 'ok',
      text: images.length
        ? 'Caption copied + image downloaded. Paste (⌘V) in LinkedIn, attach the image, post — then mark it posted.'
        : 'Caption copied. Paste it (⌘V) in LinkedIn, post, then mark it posted below.',
    })
  }

  function markPosted() {
    setMsg(null)
    start(async () => {
      const r = await markSlotPostedAction(slotId)
      if (r.error) return setMsg({ kind: 'err', text: r.error })
      setMsg({ kind: 'ok', text: 'Marked as posted ✓' })
      router.refresh()
    })
  }

  return (
    <div className="stack gap8">
      <button className="btn human" style={{ justifyContent: 'center' }} onClick={copyAndOpen} disabled={!caption.trim()}>
        Copy caption → open LinkedIn ↗
      </button>
      {opened && (
        <button className="btn good" style={{ justifyContent: 'center' }} onClick={markPosted} disabled={busy}>
          {busy ? 'Saving…' : '✓ I posted it — mark as posted'}
        </button>
      )}
      {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'err'}`}>{msg.text}</div>}
    </div>
  )
}

function downloadImage(src: string, filename: string) {
  // Best-effort download. licdn images are CORS-permissive for GET; if the fetch is blocked we
  // fall back to opening the image in a new tab so the user can save it manually.
  fetch(src)
    .then((r) => r.blob())
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    })
    .catch(() => window.open(src, '_blank', 'noopener'))
}
