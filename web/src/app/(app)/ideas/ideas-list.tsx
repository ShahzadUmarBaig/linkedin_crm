'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveIdeaAction, rejectIdeaAction, triggerGenerateIdeas, updateIdeaAction } from '@/app/actions/ideas'
import type { IdeaRow } from '@/lib/ideas'
import type { TrendItem } from '@/lib/dashboard'
import { scoreTone, sourceLabel } from '@/lib/format'

export function IdeasView({
  proposed,
  rejected,
  trends,
}: {
  proposed: IdeaRow[]
  rejected: IdeaRow[]
  trends: TrendItem[]
}) {
  const router = useRouter()
  const [generating, startGenerate] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [showRejected, setShowRejected] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busy, startBusy] = useTransition()
  const [editing, setEditing] = useState<string | null>(null)

  function runGenerate(force: boolean) {
    setMsg(null)
    startGenerate(async () => {
      const r = await triggerGenerateIdeas(force)
      if ('error' in r) return setMsg({ kind: 'err', text: r.error })
      if (r.skipped) return setMsg({ kind: 'ok', text: r.reason ?? 'Nothing to do.' })
      setMsg({
        kind: 'ok',
        text: `Generated ${r.generated} idea${r.generated === 1 ? '' : 's'}` +
          (r.costUsd != null ? ` ($${r.costUsd.toFixed(4)})` : '') + '. Refreshing…',
      })
      router.refresh()
    })
  }

  function approve(id: string) {
    setMsg(null)
    setBusyId(id)
    startBusy(async () => {
      const r = await approveIdeaAction(id)
      setBusyId(null)
      if ('error' in r) return setMsg({ kind: 'err', text: r.error })
      router.push(`/compose?slot=${r.slotId}`)
    })
  }

  function reject(id: string) {
    setBusyId(id)
    startBusy(async () => {
      const r = await rejectIdeaAction(id)
      setBusyId(null)
      if (r.error) return setMsg({ kind: 'err', text: r.error })
      router.refresh()
    })
  }

  // Rank by score so the strongest idea is the hero.
  const ranked = [...proposed].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const [hero, ...alternates] = ranked

  return (
    <>
      {/* header */}
      <div className="box pad-lg mb16">
        <div className="row between center wrap gap12">
          <div className="stack gap6">
            <span className="eyebrow">Auto-generated · refreshes nightly</span>
            <div className="h-page">
              {proposed.length > 0
                ? `${proposed.length} idea${proposed.length === 1 ? '' : 's'} for you`
                : 'No ideas in the queue'}
            </div>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              Approve one — AI drafts the text + visual next. The rest stay saved.
            </span>
          </div>
          <button className="btn ghost" onClick={() => runGenerate(false)} disabled={generating}>
            <span className="ico" />{generating ? 'Generating…' : 'Generate'}
          </button>
        </div>

        {trends.length > 0 && (
          <>
            <div className="divider" />
            <div className="row gap8 wrap center">
              <span className="eyebrow">Built from trends:</span>
              {trends.map((t) => (
                <span className="chip" key={t.topic}>
                  {t.topic}
                  <span className="bar"><i style={{ width: `${Math.round(t.weight * 100)}%` }} /></span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'err'} mb16`}>{msg.text}</div>}

      {proposed.length === 0 ? (
        <div className="box pad-lg" style={{ textAlign: 'center' }}>
          <div className="note" style={{ display: 'inline-block', textAlign: 'left' }}>
            No ideas yet. Click <b>Generate</b> above, or run a scrape from the extension — the queue
            auto-fills to 5 after each scrape.
          </div>
          <div className="mt16">
            <button className="btn primary" onClick={() => runGenerate(true)} disabled={generating}>
              {generating ? 'Generating…' : 'Generate 5 ideas'}
            </button>
          </div>
        </div>
      ) : (
        <div className="g-main">
          {/* hero — top pick */}
          <HeroCard
            idea={hero}
            onApprove={approve}
            onReject={reject}
            busy={busy && busyId === hero.id}
            editing={editing === hero.id}
            setEditing={(v) => setEditing(v ? hero.id : null)}
            onSaved={() => router.refresh()}
          />

          {/* alternates */}
          <div className="stack gap10">
            <span className="eyebrow">Alternates</span>
            {alternates.length === 0 && <div className="note">Just the one idea for now.</div>}
            {alternates.map((idea) => (
              <div className="box pad" key={idea.id}>
                <div className="row between center gap8">
                  <b style={{ fontSize: 12.5, lineHeight: 1.3 }}>{idea.hook ?? '(no hook)'}</b>
                  {idea.score != null && (
                    <span className={`tag ${scoreTone(idea.score)}`}><span className="dot" />{idea.score}</span>
                  )}
                </div>
                <div className="row between center mt8">
                  <span className="tag auto"><span className="dot" />{sourceLabel(idea.source_type)}</span>
                  <div className="row gap6">
                    <button className="btn ghost sm" onClick={() => reject(idea.id)} disabled={busy}>Skip</button>
                    <button className="btn primary sm" onClick={() => approve(idea.id)} disabled={busy && busyId === idea.id}>
                      {busy && busyId === idea.id ? '…' : 'Approve'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* rejected */}
      <div style={{ marginTop: 20, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
        <button className="vtab" onClick={() => setShowRejected((v) => !v)}>
          {showRejected ? 'Hide' : 'Show'} rejected ({rejected.length})
        </button>
        {showRejected && rejected.length > 0 && (
          <div className="stack gap8 mt12" style={{ opacity: 0.65 }}>
            {rejected.map((idea) => (
              <div className="box pad" key={idea.id}>
                <b style={{ fontSize: 12.5 }}>{idea.hook ?? '(no hook)'}</b>
                {idea.angle && <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>{idea.angle}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function HeroCard({
  idea,
  onApprove,
  onReject,
  busy,
  editing,
  setEditing,
  onSaved,
}: {
  idea: IdeaRow
  onApprove: (id: string) => void
  onReject: (id: string) => void
  busy: boolean
  editing: boolean
  setEditing: (v: boolean) => void
  onSaved: () => void
}) {
  const [hook, setHook] = useState(idea.hook ?? '')
  const [angle, setAngle] = useState(idea.angle ?? '')
  const [pillar, setPillar] = useState(idea.pillar ?? '')
  const [saving, startSave] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const score = idea.score ?? 0

  function save() {
    setErr(null)
    startSave(async () => {
      const r = await updateIdeaAction(idea.id, { hook, angle, pillar })
      if (r.error) return setErr(r.error)
      setEditing(false)
      onSaved()
    })
  }

  if (editing) {
    return (
      <div className="box pad-lg" style={{ borderColor: 'var(--line-strong)' }}>
        <span className="eyebrow">Edit idea</span>
        <div className="stack gap8 mt12">
          <textarea className="field" rows={2} value={hook} onChange={(e) => setHook(e.target.value)} placeholder="Hook" />
          <textarea className="field" rows={2} value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="Angle" />
          <input className="field" value={pillar} onChange={(e) => setPillar(e.target.value)} placeholder="Pillar" />
        </div>
        {err && <p className="banner err mt12">{err}</p>}
        <div className="row gap8 mt16">
          <button className="btn primary sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="box pad-lg" style={{ borderColor: 'var(--line-strong)' }}>
      <div className="row between center" style={{ marginBottom: 10 }}>
        <span className={`tag ${scoreTone(idea.score)}`}><span className="dot" />Top pick · {score}</span>
        <span className="tag auto"><span className="dot" />from {sourceLabel(idea.source_type)}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>{idea.hook ?? '(no hook)'}</div>
      <div className="scorebar mt12"><i style={{ width: `${score}%` }} /></div>
      {idea.angle && <div className="note mt12">{idea.angle}</div>}
      <div className="g2 mt16" style={{ gap: 10 }}>
        <div className="stat" style={{ padding: 12 }}>
          <span className="eyebrow">Score</span>
          <div className="big" style={{ fontSize: 22 }}>{score}<span style={{ fontSize: 13, color: 'var(--faint)' }}> / 100</span></div>
        </div>
        <div className="stat" style={{ padding: 12 }}>
          <span className="eyebrow">Pillar</span>
          <div className="big" style={{ fontSize: 16 }}>{idea.pillar ?? '—'}</div>
        </div>
      </div>
      {idea.topics && idea.topics.length > 0 && (
        <div className="meta-row mt12">
          {idea.topics.map((t) => <span className="tag" key={t}><span className="dot" />{t}</span>)}
        </div>
      )}
      <button className="btn primary mt16" style={{ width: '100%' }} onClick={() => onApprove(idea.id)} disabled={busy}>
        {busy ? 'Drafting…' : 'Approve & draft this →'}
      </button>
      <div className="row gap8 mt12">
        <button className="btn ghost grow" onClick={() => setEditing(true)}>Edit</button>
        <button className="btn ghost grow" onClick={() => onReject(idea.id)} disabled={busy}>Reject</button>
      </div>
      <div className="note mt12">Score blends hook quality, trend match, and your past performance on these topics.</div>
    </div>
  )
}
