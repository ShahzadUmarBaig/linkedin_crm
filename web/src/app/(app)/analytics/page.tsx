import { requireUser } from '@/lib/auth'
import { getAnalytics } from '@/lib/analytics'
import { getPostingInsights } from '@/lib/insights'
import { compactNumber, formatDate, truncate } from '@/lib/format'
import { BestWindows } from './best-windows'

export default async function AnalyticsPage() {
  const user = await requireUser()
  const [a, insights] = await Promise.all([getAnalytics(user.id), getPostingInsights(user.id)])

  if (!a.hasData) {
    return (
      <>
        <div className="box pad-lg mb16">
          <span className="eyebrow">Synced from the extension</span>
          <div className="h-page mt8">What performed — and what it teaches the engine</div>
        </div>
        <div className="box pad-lg" style={{ textAlign: 'center' }}>
          <div className="note" style={{ display: 'inline-block', textAlign: 'left' }}>
            No metrics yet. Scrape your own LinkedIn posts with the extension — each scrape captures a
            fresh impressions/reactions snapshot per post, and this screen fills in.
          </div>
        </div>
      </>
    )
  }

  const max = Math.max(1, ...a.last7Impressions)

  return (
    <>
      <div className="box pad-lg mb16">
        <span className="eyebrow">Synced from the extension</span>
        <div className="h-page mt8">What performed — and what it teaches the engine</div>
      </div>

      <BestWindows insights={insights} />

      <div className="g3 mb16">
        <div className="stat">
          <span className="eyebrow">Impressions</span>
          <div className="big num">{compactNumber(a.totalImpressions)}</div>
          <span className="delta">across {a.postCount} posts</span>
        </div>
        <div className="stat">
          <span className="eyebrow">Engagement rate</span>
          <div className="big num">{a.engagementRatePct.toFixed(1)}%</div>
          <span className="delta">reactions + comments + reposts</span>
        </div>
        <div className="stat">
          <span className="eyebrow">Followers</span>
          <div className="big num">{a.followerCount != null ? compactNumber(a.followerCount) : '—'}</div>
          <span className="delta">from your profile</span>
        </div>
      </div>

      <div className="g-main mb16" style={{ alignItems: 'start' }}>
        <div className="box pad-lg">
          <div className="row between center" style={{ marginBottom: 12 }}>
            <div className="h-sec">Impressions by post</div>
            <span className="eyebrow">last {a.last7Impressions.length} posts</span>
          </div>
          {a.last7Impressions.length > 0 ? (
            <div className="chart">
              {a.last7Impressions.map((v, i) => (
                <div className="bar" key={i} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} title={compactNumber(v)} />
              ))}
            </div>
          ) : (
            <div className="note">Not enough dated posts to chart yet.</div>
          )}
        </div>

        <div className="stack gap12">
          {a.topTopic ? (
            <div className="insight">
              <div className="ic" />
              <div className="stack gap4">
                <b style={{ fontSize: 13 }}>“{a.topTopic.topic}” posts win</b>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Posts on <b>{a.topTopic.topic}</b> averaged {a.topTopic.multiplier.toFixed(1)}× your typical
                  impressions. The engine weights that trend higher in new ideas.
                </span>
              </div>
            </div>
          ) : (
            <div className="insight accent">
              <div className="ic" />
              <div className="stack gap4">
                <b style={{ fontSize: 13 }}>Learning your patterns</b>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Once a few posts share a topic, the engine surfaces which themes earn the most reach.
                </span>
              </div>
            </div>
          )}
          <div className="note">
            Deeper insights (best time-of-day, format lift) arrive as more snapshots accumulate.
          </div>
        </div>
      </div>

      <div className="box pad-lg">
        <div className="h-sec" style={{ marginBottom: 6 }}>Post performance</div>
        <div className="perf-row hd">
          <span>Post</span><span>Impressions</span><span>Reactions</span><span>Comments</span><span>Topic</span>
        </div>
        {a.recent.map((p, i) => (
          <div className="perf-row" key={p.id} style={i === a.recent.length - 1 ? { borderBottom: 'none' } : undefined}>
            <div className="stack gap4">
              <b style={{ fontSize: 12.5 }}>{p.body ? truncate(p.body, 70) : '(no text)'}</b>
              {p.posted_at && <span className="eyebrow">posted {formatDate(p.posted_at)}</span>}
            </div>
            <span className="num">{compactNumber(p.impressions)}</span>
            <span className="num">{compactNumber(p.likes)}</span>
            <span className="num">{compactNumber(p.comments)}</span>
            {p.topics[0] ? <span className="tag auto"><span className="dot" />{p.topics[0]}</span> : <span className="eyebrow">—</span>}
          </div>
        ))}
      </div>
    </>
  )
}
