import type { ContentInsights, Ranked } from '@/lib/content-insights'
import { truncate } from '@/lib/format'

function RankList({ title, items, hint }: { title: string; items: Ranked[]; hint: string }) {
  if (items.length === 0) return null
  const max = Math.max(...items.map((i) => i.multiplier), 1.2)
  return (
    <div className="box pad-lg">
      <div className="row between center" style={{ marginBottom: 4 }}>
        <div className="h-sec">{title}</div>
        <span className="eyebrow">{hint}</span>
      </div>
      <div className="stack gap8" style={{ marginTop: 10 }}>
        {items.map((it) => {
          const win = it.multiplier >= 1.15
          const color = win ? 'var(--good)' : it.multiplier < 0.85 ? 'var(--danger)' : 'var(--muted)'
          return (
            <div key={it.key} className="stack gap4">
              <div className="row between center" style={{ fontSize: 13 }}>
                <span>{it.label} <span className="eyebrow" style={{ marginLeft: 4 }}>{it.posts} posts</span></span>
                <b className="num" style={{ color }}>{it.multiplier.toFixed(1)}×</b>
              </div>
              <div className="chip bar" style={{ width: '100%', height: 6 }}>
                <i style={{ width: `${Math.min(100, (it.multiplier / max) * 100)}%`, background: color, opacity: 0.7 }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function WhatsWorking({ insights }: { insights: ContentInsights }) {
  if (!insights.hasData) {
    return (
      <div className="box pad-lg mb16">
        <div className="h-sec" style={{ marginBottom: 6 }}>What&apos;s working in your niche</div>
        <div className="note">
          Keep scraping the feed — once ~{8} captured posts carry engagement counts, this panel learns which
          topics, formats and hooks earn the most engagement (currently {insights.sampleSize}).
        </div>
      </div>
    )
  }

  return (
    <div className="mb16">
      <div className="box pad-lg mb16">
        <div className="row between center">
          <div className="h-sec">What&apos;s working in your niche</div>
          <span className="eyebrow">from {insights.sampleSize} captured posts · engagement normalised per author</span>
        </div>
        <div className="note" style={{ marginTop: 8 }}>
          A score above 1.0× means that topic/format/hook beats the typical post in your feed. The engine uses
          these to shape new ideas, drafts and visuals.
        </div>
      </div>

      <div className="g2 mb16" style={{ alignItems: 'start' }}>
        <RankList title="Topics that win" items={insights.topTopics} hint="avg vs typical" />
        <RankList title="Formats that win" items={insights.formats} hint="media type" />
      </div>
      <div className="g2 mb16" style={{ alignItems: 'start' }}>
        <RankList title="Hooks that win" items={insights.hookStyles} hint="opening line style" />
        <RankList title="Length that wins" items={insights.lengthBands} hint="post length" />
      </div>

      {insights.topPosts.length > 0 && (
        <div className="box pad-lg">
          <div className="h-sec" style={{ marginBottom: 8 }}>Top performers (study these)</div>
          {insights.topPosts.map((p, i) => (
            <div className="perf-row" key={i} style={i === insights.topPosts.length - 1 ? { borderBottom: 'none' } : undefined}>
              <div className="stack gap4" style={{ gridColumn: '1 / span 2' }}>
                <b style={{ fontSize: 12.5 }}>{p.body ? truncate(p.body, 110) : '(no text)'}</b>
                {p.media && p.media !== 'text' && <span className="eyebrow">{p.media}</span>}
              </div>
              <span className="num">{p.likes}❤</span>
              <span className="num">{p.comments}💬</span>
              <span className="num">{p.reposts}🔁</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
