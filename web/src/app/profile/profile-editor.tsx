'use client'

import { useActionState, useState, useTransition } from 'react'
import { inferProfile, updateProfile } from '@/app/actions/profile'
import type { Pillar, ProfileRow } from '@/lib/profile'

interface Props {
  initial: ProfileRow | null
}

export function ProfileEditor({ initial }: Props) {
  const [pillars, setPillars] = useState<Pillar[]>(initial?.pillars ?? [])
  const [inferring, startInferring] = useTransition()
  const [inferResult, setInferResult] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null)

  const [saveState, formAction, saving] = useActionState(
    async (_prev: { error?: string; ok?: true } | null, formData: FormData) => {
      formData.set('pillarsJson', JSON.stringify(pillars))
      return updateProfile(formData)
    },
    null,
  )

  function runInfer() {
    startInferring(async () => {
      const result = await inferProfile()
      if ('error' in result) {
        setInferResult({ msg: result.error, kind: 'err' })
      } else {
        setInferResult({
          msg: `Inferred from ${result.sourcePostCount} posts using ${result.model}. Cost: $${result.costUsd.toFixed(4)}. Refresh to see the new values.`,
          kind: 'ok',
        })
      }
    })
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">AI inference</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Reads your most recent scraped posts and fills in niche, audience, tone, and pillars. You can edit
              everything afterwards. {initial?.inferred_at ? `Last run: ${formatDate(initial.inferred_at)} (${initial.inference_source_post_count} posts).` : 'Not yet run.'}
            </p>
          </div>
          <button
            type="button"
            onClick={runInfer}
            disabled={inferring}
            className="shrink-0 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {inferring ? 'Running…' : 'Infer from posts'}
          </button>
        </div>
        {inferResult && (
          <p
            className={`mt-3 rounded-md px-3 py-2 text-xs ${
              inferResult.kind === 'ok'
                ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
                : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
            }`}
          >
            {inferResult.msg}
          </p>
        )}
      </section>

      <form action={formAction} className="space-y-6">
        <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">Identity</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Display name" name="displayName" defaultValue={initial?.display_name ?? ''} />
            <Field label="LinkedIn URL" name="linkedinUrl" defaultValue={initial?.linkedin_url ?? ''} placeholder="https://linkedin.com/in/you" />
          </div>
          <Field label="Headline" name="headline" defaultValue={initial?.headline ?? ''} />
          <TextArea label="About / Bio" name="bio" defaultValue={initial?.bio ?? ''} rows={4} />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Location" name="location" defaultValue={initial?.location ?? ''} />
            <Field
              label="Followers"
              name="followerCount"
              type="number"
              defaultValue={initial?.follower_count != null ? String(initial.follower_count) : ''}
            />
            <Field
              label="Connections"
              name="connectionCount"
              type="number"
              defaultValue={initial?.connection_count != null ? String(initial.connection_count) : ''}
            />
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">Scraped from LinkedIn</h2>
          <p className="mb-3 text-xs text-zinc-500">
            These come from your LinkedIn topcard on each scrape. Read-only — edit them on LinkedIn to change.
          </p>
          <ReadOnlyList label="Top skills" items={initial?.top_skills ?? []} />
          <ReadOnlyList label="Services" items={initial?.services ?? []} />
          <ReadOnlyFeatured items={initial?.featured ?? []} />
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">Brand</h2>
          <TextArea label="Niche" name="niche" defaultValue={initial?.niche ?? ''} rows={2} />
          <TextArea label="Audience" name="audience" defaultValue={initial?.audience ?? ''} rows={2} />
          <Field label="Tone" name="tone" defaultValue={initial?.tone ?? ''} placeholder="e.g. casual and direct" />
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Pillars</h2>
            <button
              type="button"
              onClick={() => setPillars([...pillars, { name: '', description: '' }])}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              + Add pillar
            </button>
          </div>
          {pillars.length === 0 && (
            <p className="text-xs text-zinc-500">No pillars yet. Run AI inference or add one manually.</p>
          )}
          <div className="space-y-3">
            {pillars.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={p.name}
                  onChange={(e) => updatePillar(i, { ...p, name: e.target.value })}
                  placeholder="Name"
                  className="w-44 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                <input
                  value={p.description}
                  onChange={(e) => updatePillar(i, { ...p, description: e.target.value })}
                  placeholder="Description"
                  className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  type="button"
                  onClick={() => setPillars(pillars.filter((_, idx) => idx !== i))}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">Cadence</h2>
          <Field
            label="Posting frequency per week"
            name="postingFrequencyPerWeek"
            type="number"
            min={1}
            max={14}
            defaultValue={String(initial?.posting_frequency_per_week ?? 3)}
          />
        </section>

        <div className="flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-800">
          {saveState?.error && <p className="text-sm text-red-700 dark:text-red-300">{saveState.error}</p>}
          {saveState?.ok && !saveState.error && <p className="text-sm text-green-700 dark:text-green-300">Saved.</p>}
          <button
            type="submit"
            disabled={saving}
            className="ml-auto rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
    </div>
  )

  function updatePillar(i: number, p: Pillar) {
    setPillars(pillars.map((old, idx) => (idx === i ? p : old)))
  }
}

function ReadOnlyList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) {
    return (
      <div className="mb-3">
        <div className="mb-1 text-xs font-medium text-zinc-500">{label}</div>
        <div className="text-xs italic text-zinc-400">Not captured yet</div>
      </div>
    )
  }
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-medium text-zinc-500">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={i}
            className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

function ReadOnlyFeatured({ items }: { items: Array<{ title: string; url?: string; kind?: string }> }) {
  if (items.length === 0) {
    return (
      <div className="mb-3">
        <div className="mb-1 text-xs font-medium text-zinc-500">Featured</div>
        <div className="text-xs italic text-zinc-400">Not captured yet</div>
      </div>
    )
  }
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-medium text-zinc-500">Featured</div>
      <ul className="space-y-1 text-xs">
        {items.map((item, i) => (
          <li key={i}>
            {item.kind && <span className="mr-2 inline-block w-12 text-zinc-400">{item.kind}</span>}
            {item.url ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">
                {item.title}
              </a>
            ) : (
              <span>{item.title}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Field({
  label,
  name,
  defaultValue,
  type = 'text',
  placeholder,
  min,
  max,
}: {
  label: string
  name: string
  defaultValue?: string
  type?: string
  placeholder?: string
  min?: number
  max?: number
}) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        min={min}
        max={max}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
    </div>
  )
}

function TextArea({ label, name, defaultValue, rows }: { label: string; name: string; defaultValue?: string; rows?: number }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
      <textarea
        name={name}
        defaultValue={defaultValue}
        rows={rows ?? 3}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}
