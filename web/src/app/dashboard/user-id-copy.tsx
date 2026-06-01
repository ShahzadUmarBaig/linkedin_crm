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
      <div className="mb-1 text-xs font-medium text-zinc-500">User ID</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-sm dark:border-zinc-800 dark:bg-zinc-950">
          {userId}
        </code>
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-zinc-300 px-3 py-2 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
