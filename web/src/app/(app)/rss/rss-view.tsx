'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { RssData } from '@/lib/rss'
import { formatDate, relativeTime, truncate } from '@/lib/format'
import { addFeedAction, refreshFeedsAction, removeFeedAction } from '@/app/actions/rss'

export function RssView({ data }: { data: RssData }) {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [adding, startAdd] = useTransition()
  const [refreshing, startRefresh] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function add() {
    if (!url.trim()) return
    setMsg(null)
    startAdd(async () => {
      const r = await addFeedAction(url)
      if ('error' in r) return setMsg({ kind: 'err', text: r.error })
      setUrl('')
      setMsg({ kind: 'ok', text: `Added ${r.title ?? 'feed'} — ${r.itemsAdded} item${r.itemsAdded === 1 ? '' : 's'}.` })
      router.refresh()
    })
  }

  function refresh() {
    setMsg(null)
    startRefresh(async () => {
      const r = await refreshFeedsAction()
      if ('error' in r) return setMsg({ kind: 'err', text: r.error })
      setMsg({ kind: 'ok', text: `Fetched ${r.feedsFetched} feed${r.feedsFetched === 1 ? '' : 's'}, ${r.itemsAdded} new item${r.itemsAdded === 1 ? '' : 's'}.` })
      router.refresh()
    })
  }

  function remove(feedId: string) {
    startRefresh(async () => {
      const r = await removeFeedAction(feedId)
      if (r.error) return setMsg({ kind: 'err', text: r.error })
      router.refresh()
    })
  }

  return (
    <>
      <div className="box pad-lg mb16">
        <div className="row between center wrap gap12">
          <div className="stack gap6">
            <span className="eyebrow">Input source · newsletters &amp; blogs</span>
            <div className="h-page">RSS feeds</div>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              Add newsletter/blog RSS feeds. Fresh items flow into topics → trends → ideas, daily.
            </span>
          </div>
          <button className="btn ghost" onClick={refresh} disabled={refreshing || data.feeds.length === 0}>
            <span className="ico" />{refreshing ? 'Fetching…' : 'Refresh all'}
          </button>
        </div>

        <div className="divider" />
        <div className="row gap8 wrap">
          <input
            className="field grow"
            style={{ minWidth: 280 }}
            placeholder="https://example.com/feed.xml  (or a Substack/blog URL)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn primary" onClick={add} disabled={adding}>{adding ? 'Adding…' : 'Add feed'}</button>
        </div>
        {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'err'} mt12`}>{msg.text}</div>}
      </div>

      <div className="g-main" style={{ alignItems: 'start' }}>
        {/* items */}
        <div className="stack gap12">
          {data.items.length === 0 ? (
            <div className="box pad-lg"><div className="note">No items yet. Add a feed above — Substack/Beehiiv/Medium and most blogs expose an RSS URL (often <b>/feed</b> or <b>/rss</b>).</div></div>
          ) : (
            data.items.map((it) => (
              <div className="box pad" key={it.id}>
                <div className="row between center gap8" style={{ marginBottom: 6 }}>
                  <div className="row gap8 center wrap">
                    {it.feed_title && <span className="tag auto"><span className="dot" />{it.feed_title}</span>}
                    {it.published_at && <span className="eyebrow">{formatDate(it.published_at)}</span>}
                  </div>
                  {it.url && <a className="btn ghost sm" href={it.url} target="_blank" rel="noopener noreferrer">Read ↗</a>}
                </div>
                {it.title && <b style={{ fontSize: 14, lineHeight: 1.35 }}>{it.title}</b>}
                {it.summary && (
                  <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
                    {truncate(it.summary, 280)}
                  </p>
                )}
                {it.topics.length > 0 && (
                  <div className="meta-row mt8">
                    {it.topics.slice(0, 5).map((t) => <span className="tag" key={t}><span className="dot" />{t}</span>)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* feeds sidebar */}
        <div className="box pad-lg">
          <div className="h-sec" style={{ marginBottom: 12 }}>Your feeds ({data.feeds.length})</div>
          {data.feeds.length === 0 ? (
            <div className="note">No feeds added yet.</div>
          ) : (
            <div className="stack gap10">
              {data.feeds.map((f) => (
                <div key={f.id} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
                  <div className="row between center gap8">
                    <b style={{ fontSize: 12.5 }}>{f.title ?? f.url}</b>
                    <button className="btn danger sm" onClick={() => remove(f.id)} title="Remove feed">✕</button>
                  </div>
                  <div className="row gap8 wrap" style={{ marginTop: 4, fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--mono)' }}>
                    <span>{f.item_count ?? 0} items</span>
                    {f.last_fetched_at && <span>fetched {relativeTime(f.last_fetched_at)}</span>}
                  </div>
                  {f.last_error && <div className="eyebrow" style={{ marginTop: 4, textTransform: 'none', letterSpacing: 0, color: 'var(--danger)' }}>{truncate(f.last_error, 80)}</div>}
                </div>
              ))}
            </div>
          )}
          <div className="note mt16">Feeds refresh automatically each night with Autopilot, or hit <b>Refresh all</b>.</div>
        </div>
      </div>
    </>
  )
}
