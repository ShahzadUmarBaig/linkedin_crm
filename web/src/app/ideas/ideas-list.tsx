'use client'

import { useState, useTransition } from 'react'
import { approveIdeaAction, rejectIdeaAction, triggerGenerateIdeas, updateIdeaAction } from '@/app/actions/ideas'
import type { IdeaRow } from '@/lib/ideas'

export function IdeasList({ proposed, rejected }: { proposed: IdeaRow[]; rejected: IdeaRow[] }) {
  const [showRejected, setShowRejected] = useState(false)
  const [generating, startGenerate] = useTransition()
  const [generateMsg, setGenerateMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function runGenerate(force: boolean) {
    setGenerateMsg(null)
    startGenerate(async () => {
      const r = await triggerGenerateIdeas(force)
      if ('error' in r) {
        setGenerateMsg({ kind: 'err', text: r.error })
        return
      }
      if (r.skipped) {
        setGenerateMsg({ kind: 'ok', text: r.reason ?? 'Nothing to do.' })
        return
      }
      setGenerateMsg({
        kind: 'ok',
        text: `Generated ${r.generated} idea${r.generated === 1 ? '' : 's'}` +
          (r.costUsd != null ? ` ($${r.costUsd.toFixed(4)}${r.model ? `, ${r.model}` : ''})` : '') +
          '. Refresh to see them.',
      })
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          {proposed.length} proposed · {rejected.length} rejected
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => runGenerate(false)}
            disabled={generating}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {generating ? 'Generating…' : 'Generate ideas'}
          </button>
          <button
            type="button"
            onClick={() => runGenerate(true)}
            disabled={generating}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            title="Force a full batch of 5 even if the queue isn't empty"
          >
            Force 5
          </button>
        </div>
      </div>

      {generateMsg && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            generateMsg.kind === 'ok'
              ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
              : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
          }`}
        >
          {generateMsg.text}
        </div>
      )}

      {proposed.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {proposed.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} />
          ))}
        </div>
      )}

      <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setShowRejected(!showRejected)}
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          {showRejected ? 'Hide' : 'Show'} rejected ({rejected.length})
        </button>
        {showRejected && rejected.length > 0 && (
          <div className="mt-3 space-y-2 opacity-60">
            {rejected.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} readonly />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
      No ideas yet. Click <strong>Generate ideas</strong> above, or run a scrape from the extension —
      the queue auto-fills to 5 after each scrape.
    </div>
  )
}

function IdeaCard({ idea, readonly }: { idea: IdeaRow; readonly?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [hook, setHook] = useState(idea.hook ?? '')
  const [angle, setAngle] = useState(idea.angle ?? '')
  const [pillar, setPillar] = useState(idea.pillar ?? '')
  const [busy, startBusy] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function save() {
    setErr(null)
    startBusy(async () => {
      const r = await updateIdeaAction(idea.id, { hook, angle, pillar })
      if (r.error) setErr(r.error)
      else setEditing(false)
    })
  }

  function reject() {
    setErr(null)
    startBusy(async () => {
      const r = await rejectIdeaAction(idea.id)
      if (r.error) setErr(r.error)
    })
  }

  function approve() {
    setErr(null)
    startBusy(async () => {
      const r = await approveIdeaAction(idea.id)
      if ('error' in r) setErr(r.error)
    })
  }

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            rows={2}
            placeholder="Hook"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          <textarea
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            rows={2}
            placeholder="Angle"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          <input
            value={pillar}
            onChange={(e) => setPillar(e.target.value)}
            placeholder="Pillar"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </div>
      ) : (
        <div className="space-y-1">
          <p className="font-medium leading-snug">{idea.hook}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{idea.angle}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-zinc-500">
            {idea.pillar && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">{idea.pillar}</span>
            )}
            {idea.source_type && (
              <span className="text-zinc-400">via {sourceLabel(idea.source_type)}</span>
            )}
          </div>
        </div>
      )}

      {err && <p className="mt-2 text-xs text-red-700 dark:text-red-300">{err}</p>}

      {!readonly && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          {editing ? (
            <>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={approve}
                disabled={busy}
                className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                Approve → Draft
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={reject}
                disabled={busy}
                className="ml-auto rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Reject
              </button>
            </>
          )}
        </div>
      )}
    </article>
  )
}

function sourceLabel(src: string): string {
  switch (src) {
    case 'inspiration_post':
      return 'inspiration post'
    case 'own_post_pattern':
      return "your past post pattern"
    case 'niche_research':
      return 'niche research'
    default:
      return src
  }
}
