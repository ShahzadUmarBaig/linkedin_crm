'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { SignalsData, SignalPost, SignalPerson, SignalEngagement } from '@/lib/signals'
import { compactNumber, formatDateTime, relativeTime } from '@/lib/format'
import { extractTopicsAction } from '@/app/actions/topics'

type Tab = 'overview' | 'posts' | 'feed' | 'people' | 'engagements'

export function SignalsView({ data }: { data: SignalsData }) {
  const [tab, setTab] = useState<Tab>('overview')

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'posts', label: 'Your posts', count: data.ownPosts.length },
    { id: 'feed', label: 'Feed', count: data.inspiration.length },
    { id: 'people', label: 'People', count: data.people.length },
    { id: 'engagements', label: 'Engagements', count: data.engagements.length },
  ]

  return (
    <>
      <div className="box pad-lg mb16">
        <div className="row between center wrap gap12">
          <div className="stack gap6">
            <span className="eyebrow">Raw inputs · fed by the Chrome extension</span>
            <div className="h-page">Signals &amp; data</div>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              Everything the engine has captured. Browse your posts, the feed, people, and engagements.
            </span>
          </div>
          {data.lastSyncedAt && (
            <span className="tag good"><span className="dot" />synced {relativeTime(data.lastSyncedAt)}</span>
          )}
        </div>
      </div>

      <div className="g3 mb16" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Stat label="Your posts" value={data.ownPostsTracked} />
        <Stat label="Feed posts" value={data.feedScanned} />
        <Stat label="People" value={data.peopleCount} />
        <Stat label="Engagements" value={data.engagementsCount} />
      </div>

      <div className="vtabs mb16" style={{ display: 'flex', flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button key={t.id} className={`vtab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}{t.count != null ? ` · ${t.count}` : ''}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview data={data} />}
      {tab === 'posts' && <PostGrid posts={data.ownPosts} empty="No posts of yours captured yet. Scrape your own activity page." />}
      {tab === 'feed' && <PostGrid posts={data.inspiration} feed empty="No feed posts captured yet. Scroll your LinkedIn feed with the extension on." />}
      {tab === 'people' && <People people={data.people} />}
      {tab === 'engagements' && <Engagements items={data.engagements} />}
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="eyebrow">{label}</span>
      <div className="big num">{compactNumber(value)}</div>
    </div>
  )
}

function Overview({ data }: { data: SignalsData }) {
  const router = useRouter()
  const [running, start] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function runExtract() {
    setMsg(null)
    start(async () => {
      const r = await extractTopicsAction()
      if ('error' in r) return setMsg({ kind: 'err', text: r.error })
      if (r.skipped) return setMsg({ kind: 'ok', text: r.reason ?? 'Nothing to tag.' })
      setMsg({
        kind: 'ok',
        text: `Tagged ${r.processed} post${r.processed === 1 ? '' : 's'}` +
          (r.costUsd != null ? ` ($${r.costUsd.toFixed(4)})` : '') + '. Refreshing…',
      })
      router.refresh()
    })
  }

  return (
    <div className="g2" style={{ alignItems: 'start' }}>
      <div className="box pad-lg">
        <div className="row between center" style={{ marginBottom: 12 }}>
          <div className="h-sec">Detected trends (drives Ideas)</div>
          <button className="btn ghost sm" onClick={runExtract} disabled={running}>
            {running ? 'Tagging…' : 'Extract topics'}
          </button>
        </div>
        {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'err'} mb16`}>{msg.text}</div>}
        {data.trends.length === 0 ? (
          <div className="note">No trends yet — click <b>Extract topics</b> to tag your scraped posts, or they&apos;ll be tagged automatically on the next scrape.</div>
        ) : (
          <div className="stack gap10">
            {data.trends.map((t) => (
              <div className="row between center gap10" key={t.topic}>
                <span className="chip" style={{ flex: 1, justifyContent: 'space-between' }}>
                  {t.topic}
                  <span className="bar"><i style={{ width: `${Math.round(t.weight * 100)}%` }} /></span>
                </span>
                <span className="eyebrow">{t.count}×</span>
              </div>
            ))}
          </div>
        )}
        <div className="note mt16">Feed topics → these counts → trend scores → the ideas.</div>
      </div>

      <div className="box pad-lg">
        <div className="h-sec" style={{ marginBottom: 12 }}>Capture summary</div>
        <div className="stack gap10">
          <SummaryRow label="Your posts tracked" value={data.ownPostsTracked} />
          <div className="divider" style={{ margin: '2px 0' }} />
          <SummaryRow label="Feed posts scanned" value={data.feedScanned} />
          <div className="divider" style={{ margin: '2px 0' }} />
          <SummaryRow label="People seen" value={data.peopleCount} />
          <div className="divider" style={{ margin: '2px 0' }} />
          <SummaryRow label="Engagements logged" value={data.engagementsCount} />
        </div>
        <div className="note mt16">Open any tab above to inspect the raw rows, including images and metrics.</div>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="row between center">
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</span>
      <span className="num" style={{ fontWeight: 700 }}>{compactNumber(value)}</span>
    </div>
  )
}

function PostGrid({ posts, feed, empty }: { posts: SignalPost[]; feed?: boolean; empty: string }) {
  if (posts.length === 0) return <div className="box pad-lg"><div className="note">{empty}</div></div>
  return (
    <div className="g2" style={{ alignItems: 'start' }}>
      {posts.map((p) => <PostCard key={p.id} post={p} feed={feed} />)}
    </div>
  )
}

function PostCard({ post, feed }: { post: SignalPost; feed?: boolean }) {
  return (
    <div className="box pad">
      <div className="row between center gap8" style={{ marginBottom: 8 }}>
        <div className="row gap8 center wrap">
          {feed && post.author && <span className="tag"><span className="dot" />{post.author}</span>}
          {post.media && post.media !== 'text' && <span className="tag auto"><span className="dot" />{post.media}</span>}
          {post.posted_at && <span className="eyebrow">{formatDateTime(post.posted_at)}</span>}
        </div>
        {post.url && (
          <a className="btn ghost sm" href={post.url} target="_blank" rel="noopener noreferrer">Open ↗</a>
        )}
      </div>

      {post.body && (
        <p style={{ fontSize: 13, lineHeight: 1.55, margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>
          {post.body.length > 600 ? post.body.slice(0, 600).trimEnd() + '…' : post.body}
        </p>
      )}

      {post.images.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: post.images.length === 1 ? '1fr' : 'repeat(2, 1fr)',
            gap: 6,
            marginBottom: 10,
          }}
        >
          {post.images.slice(0, 4).map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt=""
              loading="lazy"
              style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--panel-2)' }}
            />
          ))}
        </div>
      )}

      <div className="row gap12 wrap" style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
        {post.impressions != null && <span>👁 {compactNumber(post.impressions)}</span>}
        {post.likes != null && <span>👍 {compactNumber(post.likes)}</span>}
        {post.comments != null && <span>💬 {compactNumber(post.comments)}</span>}
        {post.reposts != null && <span>↻ {compactNumber(post.reposts)}</span>}
      </div>

      {post.topics.length > 0 && (
        <div className="meta-row mt8">
          {post.topics.slice(0, 5).map((t) => <span className="tag" key={t}><span className="dot" />{t}</span>)}
        </div>
      )}
    </div>
  )
}

function People({ people }: { people: SignalPerson[] }) {
  if (people.length === 0) return <div className="box pad-lg"><div className="note">No people captured yet.</div></div>
  return (
    <div className="g2" style={{ alignItems: 'start' }}>
      {people.map((p) => (
        <div className="box pad" key={p.id}>
          <div className="row gap10" style={{ alignItems: 'flex-start' }}>
            <div className="avatar">{(p.full_name?.[0] ?? '·').toUpperCase()}</div>
            <div className="grow stack gap4" style={{ minWidth: 0 }}>
              <div className="row between center gap8">
                <b style={{ fontSize: 13 }}>{p.full_name ?? 'Unknown'}</b>
                {p.is_connection && <span className="tag good"><span className="dot" />1st</span>}
              </div>
              {p.headline && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{p.headline}</span>}
              <div className="row gap8 wrap" style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--mono)' }}>
                {p.location && <span>{p.location}</span>}
                {p.follower_count != null && <span>{compactNumber(p.follower_count)} followers</span>}
                {p.connection_count != null && <span>{compactNumber(p.connection_count)} connections</span>}
              </div>
              {p.top_skills.length > 0 && (
                <div className="meta-row mt8">
                  {p.top_skills.slice(0, 4).map((s) => <span className="tag" key={s}><span className="dot" />{s}</span>)}
                </div>
              )}
            </div>
            {p.profile_url && (
              <a className="btn ghost sm" href={p.profile_url} target="_blank" rel="noopener noreferrer">↗</a>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function Engagements({ items }: { items: SignalEngagement[] }) {
  if (items.length === 0) return <div className="box pad-lg"><div className="note">No engagements captured yet.</div></div>
  return (
    <div className="box" style={{ overflow: 'hidden' }}>
      {items.map((e, i) => (
        <div
          key={e.id}
          className="pad"
          style={{ borderBottom: i === items.length - 1 ? 'none' : '1px solid var(--line)' }}
        >
          <div className="row between center gap8" style={{ marginBottom: e.comment_text ? 6 : 0 }}>
            <div className="row gap8 center">
              <b style={{ fontSize: 12.5 }}>{e.person_name ?? 'Someone'}</b>
              <span className="tag auto"><span className="dot" />{e.reaction ?? e.type}</span>
            </div>
            {e.engaged_at && <span className="eyebrow">{relativeTime(e.engaged_at)}</span>}
          </div>
          {e.comment_text && (
            <p style={{ fontSize: 12.5, color: 'var(--ink)', margin: '0 0 6px' }}>“{e.comment_text}”</p>
          )}
          {e.post_body && (
            <p style={{ fontSize: 11, color: 'var(--faint)', margin: 0 }}>
              on: {e.post_body.length > 100 ? e.post_body.slice(0, 100).trimEnd() + '…' : e.post_body}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
