'use client'

import { useState } from 'react'

export function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div>
      <label className="label">{label}</label>
      <div className="row gap8">
        <code className="field mono grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value}
        </code>
        <button type="button" onClick={copy} className="btn sm">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {hint && <p className="eyebrow" style={{ marginTop: 5, textTransform: 'none', letterSpacing: 0 }}>{hint}</p>}
    </div>
  )
}
