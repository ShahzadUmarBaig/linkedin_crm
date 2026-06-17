import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { getHomeData, getDashboardStats, type DashboardStats } from '@/lib/dashboard'
import { compactNumber, formatDayTime, relativeTime, truncate } from '@/lib/format'
import { UserIdCopy } from './user-id-copy'

const PIPELINE: { label: string; meta: string; human?: boolean }[] = [
  { label: 'Scrape', meta: 'extension' },
  { label: 'Trend scan', meta: 'auto' },
  { label: '5 ideas', meta: 'auto' },
  { label: 'Approve', meta: 'you', human: true },
  { label: 'Draft text', meta: 'auto' },
  { label: 'Visual', meta: 'auto' },
  { label: 'Schedule', meta: 'auto' },
  { label: 'Post', meta: 'you', human: true },
]

function hourLabel(h: number | null): string {
  if (h == null) return '—'
  const ampm = h < 12 ? 'am' : 'pm'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}${ampm}`
}

export default async function HomePage() {
  const user = await requireUser()
  const [data, stats] = await Promise.all([getHomeData(user.id), getDashboardStats(user.id)])

  const todos: { n: number; title: string; tag: { cls: string; text: string }; href: string; cta: string }[] = []
  if (data.proposedIdeas.length > 0) {
    todos.push({ n: todos.length + 1, title: 'Approve an idea', tag: { cls: 'good', text: `${data.proposedIdeas.length} waiting` }, href: '/ideas', cta: 'Review →' })
  }
  if (data.dueSlots.length > 0) {
    todos.push({ n: todos.length + 1, title: 'Post the scheduled draft', tag: { cls: 'human', text: 'ready now' }, href: '/calendar', cta: 'Open →' })
  }

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const postsDelta = stats.postedThisWeek - stats.postedPrevWeek
  const hasOwn = stats.ownPostCount > 0

  return (
    <>
      {/* Hero — what needs you today */}
      <div className="box pad-lg mb16">
        <div className="row between center wrap gap12">
          <div className="stack gap4">
            <span className="eyebrow">{today}</span>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {todos.length === 0 ? "You're all caught up" : `You have ${todos.length} thing${todos.length === 1 ? '' : 's'} to do today`}
            </div>
          </div>
          <div className="row gap8">
            {todos.map((t) => (
              <Link className="btn human sm" href={t.href} key={t.n}>{t.title} →</Link>
            ))}
            {todos.length === 0 && <span className="tag auto"><span className="dot" />engine running</span>}
          </div>
        </div>
      </div>

      {!data.lastScrape && <SetupCard userId={user.id} hasProfile={data.hasProfile} />}

      {/* ---------- GROWTH & PERFORMANCE (lead) ---------- */}
      <div className="row between center" style={{ marginBottom: 10 }}>
        <div className="h-page" style={{ fontSize: 15 }}>Your growth</div>
        <Link className="btn ghost sm" href="/analytics">Full analytics →</Link>
      </div>

      <div className="g-kpi mb16">
        <Kpi label="Impressions" value={hasOwn ? compactNumber(stats.totalImpressions) : '—'} sub={hasOwn ? `across ${stats.ownPostCount} posts` : 'scrape your posts'} />
        <Kpi label="Engagement rate" value={hasOwn ? `${stats.engagementRatePct.toFixed(1)}%` : '—'} sub="reactions+comments+reposts" />
        <Kpi label="Followers" value={stats.followerCount != null ? compactNumber(stats.followerCount) : '—'} sub="from your profile" />
        <Kpi
          label="Posts this week"
          value={String(stats.postedThisWeek)}
          sub={postsDelta === 0 ? 'same as last week' : `${postsDelta > 0 ? '+' : ''}${postsDelta} vs last week`}
          good={postsDelta > 0}
          bad={postsDelta < 0}
        />
      </div>

      <div className="g-main mb16" style={{ alignItems: 'start' }}>
        <div className="box pad-lg">
          <div className="row between center" style={{ marginBottom: 10 }}>
            <div className="h-sec">Posts per day</div>
            <span className="eyebrow">last 21 days · best {stats.bestDay ?? '—'} {hourLabel(stats.bestHour)}</span>
          </div>
          <PostsChart data={stats.postsPerDay} />
        </div>

        <div className="box pad-lg">
          <div className="h-sec" style={{ marginBottom: 8 }}>Your top posts</div>
          {stats.topPosts.length === 0 ? (
            <div className="note">No post performance yet. Scrape your own posts (extension → “Open my posts to scrape”) and they’ll rank here.</div>
          ) : (
            stats.topPosts.map((p, i) => (
              <div className="perf-row" key={i} style={i === stats.topPosts.length - 1 ? { borderBottom: 'none' } : undefined}>
                <b style={{ fontSize: 12.5, gridColumn: '1 / span 2' }}>{p.body ? truncate(p.body, 90) : '(no text)'}</b>
                <span className="num">{p.likes}❤</span>
                <span className="num">{p.comments}💬</span>
                <span className="num">{p.reposts}🔁</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ---------- COACHING: playbook + what's working ---------- */}
      <div className="g-main mb16" style={{ alignItems: 'start' }}>
        <div className="box pad-lg">
          <div className="row between center" style={{ marginBottom: 8 }}>
            <div className="h-sec">Your playbook</div>
            <span className="eyebrow">{stats.playbookUpdatedAt ? `updated ${relativeTime(stats.playbookUpdatedAt)}` : 'learns from your results'}</span>
          </div>
          {stats.playbook ? (
            <div className="stack gap6">
              {stats.playbook.split('\n').map((l) => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean).slice(0, 8).map((line, i) => (
                <div className="row gap8" key={i} style={{ fontSize: 13, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--good)', fontWeight: 700 }}>→</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="note">Your personalised playbook appears here once the engine has enough of your results to learn from. It rewrites itself nightly.</div>
          )}
        </div>

        <div className="box pad-lg">
          <div className="row between center" style={{ marginBottom: 8 }}>
            <div className="h-sec">What’s working</div>
            <Link className="btn ghost sm" href="/analytics">Details →</Link>
          </div>
          {stats.topTopic || stats.topFormat || stats.topHook ? (
            <div className="stack gap10">
              <WinRow label="Top topic" item={stats.topTopic} />
              <WinRow label="Best format" item={stats.topFormat} />
              <WinRow label="Best hook" item={stats.topHook} />
            </div>
          ) : (
            <div className="note">Keep scraping the feed — once there’s enough signal, the winning topics, formats and hooks show here.</div>
          )}
        </div>
      </div>

      {/* ---------- PIPELINE ---------- */}
      <div className="box pad-lg mb16">
        <div className="row between center" style={{ marginBottom: 6 }}>
          <div className="h-sec">The automation pipeline</div>
          <span className="eyebrow">
            {stats.autopilotEnabled ? 'autopilot on' : 'autopilot off'} ·{' '}
            {data.lastScrape?.finished_at ? `last scrape ${relativeTime(data.lastScrape.finished_at)}` : 'no scrapes yet'}
          </span>
        </div>
        <div className="pipe">
          {PIPELINE.map((s) => (
            <div className={`pstep${s.human ? ' human' : ''}`} key={s.label}>
              <div className="nodewrap"><div className="node"><span className="gi" /></div></div>
              <div className="plbl">{s.label}</div>
              <div className="pmeta">{s.meta}</div>
            </div>
          ))}
        </div>
        <div className="g-pipe-stats mt12">
          <PipeStat n={stats.ideasWaiting} label="ideas waiting" href="/ideas" />
          <PipeStat n={stats.weekScheduled} label="scheduled this week" href="/calendar" />
          <PipeStat n={data.lastScrape?.inspiration_captured ?? 0} label="posts last scrape" href="/signals" />
          <PipeStat n={stats.postedThisWeek} label="posted this week" href="/calendar" />
        </div>
      </div>

      {/* ---------- queue + up next + trends ---------- */}
      <div className="g-main">
        <div className="box pad-lg">
          <div className="row between center" style={{ marginBottom: 12 }}>
            <div className="h-sec">Needs your approval</div>
            <span className="tag human"><span className="dot" />{data.proposedIdeas.length} waiting</span>
          </div>
          {data.proposedIdeas.length === 0 ? (
            <div className="note">No ideas in the queue. They refill automatically after each scrape — or generate now on the <b>Ideas</b> screen.</div>
          ) : (
            <div className="stack gap12">
              {data.proposedIdeas.slice(0, 4).map((idea) => (
                <div className="todo" key={idea.id} style={{ borderRadius: 9 }}>
                  <div className="grow stack gap6">
                    <b style={{ fontSize: 13 }}>{idea.hook ? truncate(idea.hook, 90) : '(no hook)'}</b>
                    <div className="meta-row">
                      <span className="tag auto"><span className="dot" />drafted by AI</span>
                      {idea.pillar && <span className="tag"><span className="dot" />{idea.pillar}</span>}
                    </div>
                  </div>
                  <Link className="btn human sm" href="/ideas">Review</Link>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="stack gap16">
          <div className="box pad-lg">
            <div className="row between center" style={{ marginBottom: 10 }}>
              <div className="h-sec">Up next on calendar</div>
              <Link className="btn ghost sm" href="/calendar">Calendar</Link>
            </div>
            {data.upcomingSlots.length === 0 ? (
              <div className="note">Nothing scheduled yet. Approve an idea to fill your calendar.</div>
            ) : (
              <div className="stack gap8">
                {data.upcomingSlots.map((s, i) => (
                  <div key={s.slot_id}>
                    {i > 0 && <div className="divider" style={{ margin: '6px 0' }} />}
                    <div className="row gap10 center">
                      <span className="tag sched"><span className="dot" />{formatDayTime(s.scheduled_for)}</span>
                      <span style={{ fontSize: 12.5 }}>{s.idea_hook ? truncate(s.idea_hook, 48) : 'Scheduled post'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="box pad-lg">
            <div className="h-sec" style={{ marginBottom: 10 }}>Trending in your network</div>
            {data.trends.length === 0 ? (
              <div className="note">No trends detected yet — scan more of your feed with the extension.</div>
            ) : (
              <div className="stack gap8">
                {data.trends.slice(0, 4).map((t) => (
                  <div className="chip" key={t.topic} style={{ width: '100%', justifyContent: 'space-between' }}>
                    {t.topic}
                    <span className="bar"><i style={{ width: `${Math.round(t.weight * 100)}%` }} /></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function Kpi({ label, value, sub, good, bad }: { label: string; value: string; sub: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="stat">
      <span className="eyebrow">{label}</span>
      <div className="big num">{value}</div>
      <span className="delta" style={{ color: good ? 'var(--good)' : bad ? 'var(--danger)' : 'var(--muted)' }}>{sub}</span>
    </div>
  )
}

function PostsChart({ data }: { data: DashboardStats['postsPerDay'] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const total = data.reduce((s, d) => s + d.count, 0)
  if (total === 0) {
    return <div className="note">No posts published in the last 21 days. Mark posts as posted (or scrape your activity) and your cadence shows here.</div>
  }
  return (
    <div className="chart" style={{ alignItems: 'flex-end' }}>
      {data.map((d, i) => (
        <div
          className="bar"
          key={i}
          style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }}
          title={`${d.label}: ${d.count} post${d.count === 1 ? '' : 's'}`}
        />
      ))}
    </div>
  )
}

function WinRow({ label, item }: { label: string; item: { label: string; multiplier: number } | null }) {
  return (
    <div className="row between center" style={{ fontSize: 13 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      {item ? (
        <span><b>{item.label}</b> <span className="num" style={{ color: item.multiplier >= 1.1 ? 'var(--good)' : 'var(--muted)' }}>{item.multiplier.toFixed(1)}×</span></span>
      ) : (
        <span className="eyebrow">—</span>
      )}
    </div>
  )
}

function PipeStat({ n, label, href }: { n: number; label: string; href: string }) {
  return (
    <Link href={href} className="pipe-stat">
      <span className="num" style={{ fontSize: 18, fontWeight: 700 }}>{n}</span>
      <span className="eyebrow" style={{ textTransform: 'none', letterSpacing: 0 }}>{label}</span>
    </Link>
  )
}

function SetupCard({ userId, hasProfile }: { userId: string; hasProfile: boolean }) {
  return (
    <div className="box pad-lg mb16">
      <span className="eyebrow">Get started</span>
      <div className="h-sec mt8">Connect the Chrome extension</div>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 14px' }}>
        Open the LinkedIn CRM extension popup and paste these into its Settings. Then browse your
        LinkedIn activity and hit “Scrape” — the engine takes over from there.
      </p>
      <div style={{ maxWidth: 520 }}><UserIdCopy userId={userId} /></div>
      <div className="note mt16">
        Ingest secret = <b>EXTENSION_INGEST_SECRET</b> from web/.env.local · API base URL = your CRM URL.
        {!hasProfile && <> After your first scrape, run <b>AI inference</b> on the Profile screen.</>}
      </div>
    </div>
  )
}
