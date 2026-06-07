'use client'

import type { PostingInsights } from '@/lib/insights'
import { compactNumber } from '@/lib/format'

export function BestWindows({ insights }: { insights: PostingInsights }) {
  const { hasEnoughData, sampleSize, metric, bestDays, bestHours, bestTopics } = insights

  if (!hasEnoughData) {
    return (
      <div className="box pad-lg mb16">
        <div className="row between center" style={{ marginBottom: 8 }}>
          <div className="h-sec">Best posting windows</div>
          <span className="tag"><span className="dot" />learning</span>
        </div>
        <div className="note">
          Need ~8 of your own posts with metrics to compute your best days/times — have <b>{sampleSize}</b>.
          Until then, scheduling uses sensible weekday-morning defaults and improves automatically as data lands.
        </div>
      </div>
    )
  }

  const topDays = bestDays.slice(0, 3)
  const maxDay = Math.max(1, ...topDays.map((d) => d.avg))
  const topHour = bestHours[0]
  const metricLabel = metric === 'impressions' ? 'impressions' : 'engagement'

  return (
    <div className="box pad-lg mb16">
      <div className="row between center" style={{ marginBottom: 12 }}>
        <div className="h-sec">Best posting windows</div>
        <span className="tag good"><span className="dot" />drives scheduling</span>
      </div>

      <div className="g3" style={{ gap: 16 }}>
        {/* best days */}
        <div>
          <span className="eyebrow">Best days</span>
          <div className="stack gap8 mt8">
            {topDays.map((d) => (
              <div className="row between center gap10" key={d.dow}>
                <span style={{ fontSize: 13, fontWeight: 600, width: 84 }}>{d.name}</span>
                <span className="bar" style={{ flex: 1, height: 8 }}><i style={{ width: `${Math.round((d.avg / maxDay) * 100)}%` }} /></span>
              </div>
            ))}
          </div>
        </div>

        {/* best time */}
        <div>
          <span className="eyebrow">Best time</span>
          <div className="big mt8" style={{ fontSize: 22 }}>{topHour ? localHour(topHour.hour) : '—'}</div>
          {topHour && <span className="eyebrow" style={{ textTransform: 'none', letterSpacing: 0 }}>{pad(topHour.hour)}:00 UTC · avg {compactNumber(Math.round(topHour.avg))} {metricLabel}</span>}
        </div>

        {/* best topics */}
        <div>
          <span className="eyebrow">Best topics</span>
          <div className="meta-row mt8">
            {bestTopics.length === 0 ? (
              <span className="eyebrow">—</span>
            ) : (
              bestTopics.slice(0, 5).map((t) => (
                <span className="tag good" key={t.topic} title={`${t.ratio.toFixed(1)}× your average`}>
                  <span className="dot" />{t.topic} · {t.ratio.toFixed(1)}×
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="note mt16">
        New posts are auto-scheduled into these windows, and ideas on your best topics score higher.
        Based on <b>{sampleSize}</b> posts (by {metricLabel}).
      </div>
    </div>
  )
}

// Convert a UTC hour-of-day to the viewer's local hour label.
function localHour(utcHour: number): string {
  const d = new Date(Date.UTC(2024, 0, 1, utcHour, 0, 0))
  return d.toLocaleTimeString(undefined, { hour: 'numeric' })
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
