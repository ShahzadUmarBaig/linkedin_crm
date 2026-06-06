import { requireUser } from '@/lib/auth'
import { getSignals } from '@/lib/signals'
import { compactNumber, relativeTime, truncate } from '@/lib/format'

export default async function SignalsPage() {
  const user = await requireUser()
  const s = await getSignals(user.id)

  return (
    <>
      <div className="box pad-lg mb16">
        <div className="row between center wrap gap12">
          <div className="stack gap6">
            <span className="eyebrow">Raw inputs · fed by the Chrome extension</span>
            <div className="h-page">Signals &amp; data</div>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              What the engine reads to find trends. You rarely touch it — it&apos;s here for transparency.
            </span>
          </div>
          {s.lastSyncedAt && (
            <span className="tag good"><span className="dot" />synced {relativeTime(s.lastSyncedAt)}</span>
          )}
        </div>
      </div>

      <div className="g3 mb16">
        <div className="stat"><span className="eyebrow">Feed posts scanned</span><div className="big num">{compactNumber(s.feedScanned)}</div></div>
        <div className="stat"><span className="eyebrow">Your posts tracked</span><div className="big num">{compactNumber(s.ownPostsTracked)}</div></div>
        <div className="stat"><span className="eyebrow">Trends detected</span><div className="big num">{s.trendsDetected}</div></div>
      </div>

      <div className="g2" style={{ alignItems: 'start' }}>
        <div className="box pad-lg">
          <div className="h-sec" style={{ marginBottom: 12 }}>Detected trends (drives Ideas)</div>
          {s.trends.length === 0 ? (
            <div className="note">No trends yet — the extension extracts topics from feed posts on each scrape.</div>
          ) : (
            <div className="stack gap10">
              {s.trends.map((t) => (
                <div className="row between center gap10" key={t.topic}>
                  <span className="chip" style={{ flex: 1, justifyContent: 'space-between' }}>
                    {t.topic}
                    <span className="bar"><i style={{ width: `${Math.round(t.weight * 100)}%` }} /></span>
                  </span>
                  <span className="eyebrow">{t.count} mentions</span>
                </div>
              ))}
            </div>
          )}
          <div className="note mt16">Extension scrapes your feed → these counts → trend scores → the ideas.</div>
        </div>

        <div className="box pad-lg">
          <div className="h-sec" style={{ marginBottom: 12 }}>Recent feed sample</div>
          {s.feedSample.length === 0 ? (
            <div className="note">No feed posts captured yet.</div>
          ) : (
            <div className="stack gap10">
              {s.feedSample.map((f, i) => (
                <div key={f.id}>
                  {i > 0 && <div className="divider" style={{ margin: '4px 0' }} />}
                  <div className="row gap10 center">
                    <div className="avatar sm">{(f.author?.[0] ?? '·').toUpperCase()}</div>
                    <div className="grow stack gap4">
                      <b style={{ fontSize: 12.5 }}>{f.author ?? 'Someone in your feed'}</b>
                      {f.body && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{truncate(f.body, 90)}</span>}
                    </div>
                    {f.topics[0] && <span className="tag auto"><span className="dot" />{f.topics[0]}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
