'use client'

import { useState } from 'react'

export function UserIdCopy({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(userId)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div>
      <span className="label">User ID</span>
      <div className="row gap8">
        <code className="field mono grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {userId}
        </code>
        <button type="button" onClick={copy} className="btn sm">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
