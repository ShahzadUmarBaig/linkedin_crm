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

  function updatePillar(i: number, p: Pillar) {
    setPillars(pillars.map((old, idx) => (idx === i ? p : old)))
  }

  return (
    <div className="stack gap16">
      <div className="box pad-lg">
        <div className="row between center gap16 wrap">
          <div className="stack gap4">
            <span className="eyebrow">AI inference</span>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, maxWidth: 560 }}>
              Reads your most recent scraped posts and fills in niche, audience, tone, and pillars — all
              editable afterwards.{' '}
              {initial?.inferred_at
                ? `Last run: ${formatDate(initial.inferred_at)} (${initial.inference_source_post_count} posts).`
                : 'Not yet run.'}
            </p>
          </div>
          <button type="button" onClick={runInfer} disabled={inferring} className="btn primary">
            {inferring ? 'Running…' : 'Infer from posts'}
          </button>
        </div>
        {inferResult && <div className={`banner ${inferResult.kind === 'ok' ? 'ok' : 'err'} mt12`}>{inferResult.msg}</div>}
      </div>

      <form action={formAction} className="stack gap16">
        <div className="box pad-lg">
          <span className="eyebrow">Identity</span>
          <div className="g2 mt12" style={{ gap: 12 }}>
            <Field label="Display name" name="displayName" defaultValue={initial?.display_name ?? ''} />
            <Field label="LinkedIn URL" name="linkedinUrl" defaultValue={initial?.linkedin_url ?? ''} placeholder="https://linkedin.com/in/you" />
          </div>
          <Field label="Headline" name="headline" defaultValue={initial?.headline ?? ''} />
          <TextArea label="About / Bio" name="bio" defaultValue={initial?.bio ?? ''} rows={4} />
          <div className="g3" style={{ gap: 10 }}>
            <Field label="Location" name="location" defaultValue={initial?.location ?? ''} />
            <Field label="Followers" name="followerCount" type="number" defaultValue={initial?.follower_count != null ? String(initial.follower_count) : ''} />
            <Field label="Connections" name="connectionCount" type="number" defaultValue={initial?.connection_count != null ? String(initial.connection_count) : ''} />
          </div>
        </div>

        <div className="box pad-lg">
          <span className="eyebrow">Scraped from LinkedIn</span>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 12px' }}>
            From your LinkedIn topcard on each scrape. Read-only — edit them on LinkedIn to change.
          </p>
          <ReadOnlyList label="Top skills" items={initial?.top_skills ?? []} />
          <ReadOnlyList label="Services" items={initial?.services ?? []} />
          <ReadOnlyFeatured items={initial?.featured ?? []} />
        </div>

        <div className="box pad-lg">
          <span className="eyebrow">Brand</span>
          <div className="mt12">
            <TextArea label="Niche" name="niche" defaultValue={initial?.niche ?? ''} rows={2} />
            <TextArea label="Audience" name="audience" defaultValue={initial?.audience ?? ''} rows={2} />
            <Field label="Tone" name="tone" defaultValue={initial?.tone ?? ''} placeholder="e.g. casual and direct" />
          </div>
        </div>

        <div className="box pad-lg">
          <div className="row between center" style={{ marginBottom: 12 }}>
            <span className="eyebrow">Pillars</span>
            <button type="button" className="vtab" onClick={() => setPillars([...pillars, { name: '', description: '' }])}>
              + Add pillar
            </button>
          </div>
          {pillars.length === 0 && <div className="note">No pillars yet. Run AI inference or add one manually.</div>}
          <div className="stack gap8">
            {pillars.map((p, i) => (
              <div className="row gap8" key={i}>
                <input className="field" style={{ width: 180 }} value={p.name} onChange={(e) => updatePillar(i, { ...p, name: e.target.value })} placeholder="Name" />
                <input className="field grow" value={p.description} onChange={(e) => updatePillar(i, { ...p, description: e.target.value })} placeholder="Description" />
                <button type="button" className="btn danger sm" onClick={() => setPillars(pillars.filter((_, idx) => idx !== i))}>Remove</button>
              </div>
            ))}
          </div>
        </div>

        <div className="box pad-lg">
          <span className="eyebrow">Cadence</span>
          <div className="mt12" style={{ maxWidth: 280 }}>
            <Field label="Posting frequency per week" name="postingFrequencyPerWeek" type="number" min={1} max={14} defaultValue={String(initial?.posting_frequency_per_week ?? 3)} />
          </div>
        </div>

        <div className="row between center" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          {saveState?.error && <span className="banner err">{saveState.error}</span>}
          {saveState?.ok && !saveState.error && <span className="banner ok">Saved.</span>}
          <button type="submit" disabled={saving} className="btn primary" style={{ marginLeft: 'auto' }}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ReadOnlyList({ label, items }: { label: string; items: string[] }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <span className="label">{label}</span>
      {items.length === 0 ? (
        <span style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--faint)' }}>Not captured yet</span>
      ) : (
        <div className="row wrap gap6">
          {items.map((item, i) => <span className="chip" key={i}>{item}</span>)}
        </div>
      )}
    </div>
  )
}

function ReadOnlyFeatured({ items }: { items: Array<{ title: string; url?: string; kind?: string }> }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <span className="label">Featured</span>
      {items.length === 0 ? (
        <span style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--faint)' }}>Not captured yet</span>
      ) : (
        <ul className="stack gap4" style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12 }}>
          {items.map((item, i) => (
            <li key={i}>
              {item.kind && <span className="eyebrow" style={{ marginRight: 8 }}>{item.kind}</span>}
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{item.title}</a>
              ) : (
                <span>{item.title}</span>
              )}
            </li>
          ))}
        </ul>
      )}
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
    <div style={{ marginBottom: 12 }}>
      <label className="label">{label}</label>
      <input className="field" name={name} type={type} defaultValue={defaultValue} placeholder={placeholder} min={min} max={max} />
    </div>
  )
}

function TextArea({ label, name, defaultValue, rows }: { label: string; name: string; defaultValue?: string; rows?: number }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label className="label">{label}</label>
      <textarea className="field" name={name} defaultValue={defaultValue} rows={rows ?? 3} />
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}
