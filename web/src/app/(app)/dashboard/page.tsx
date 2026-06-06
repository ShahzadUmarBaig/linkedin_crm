import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { getHomeData } from '@/lib/dashboard'
import { formatDayTime, relativeTime, truncate } from '@/lib/format'
import { UserIdCopy } from './user-id-copy'

const PIPELINE: { label: string; meta: string; human?: boolean }[] = [
  { label: 'Scrape', meta: 'extension' },
  { label: 'Trend scan', meta: 'auto' },
  { label: '5 ideas', meta: 'auto' },
  { label: 'Approve', meta: 'you', human: true },
  { label: 'Draft text', meta: 'auto' },
  { label: 'Visual', meta: 'soon' },
  { label: 'Schedule', meta: 'auto' },
  { label: 'Post', meta: 'you', human: true },
]

export default async function HomePage() {
  const user = await requireUser()
  const data = await getHomeData(user.id)

  const todos: { n: number; title: string; tag: { cls: string; text: string }; href: string; cta: string }[] = []
  if (data.proposedIdeas.length > 0) {
    todos.push({
      n: todos.length + 1,
      title: 'Approve an idea',
      tag: { cls: 'good', text: `${data.proposedIdeas.length} waiting` },
      href: '/ideas',
      cta: 'Review →',
    })
  }
  if (data.dueSlots.length > 0) {
    todos.push({
      n: todos.length + 1,
      title: 'Post the scheduled draft',
      tag: { cls: 'human', text: 'ready now' },
      href: '/calendar',
      cta: 'Open →',
    })
  }

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <>
      {/* Hero — the only things you need to do */}
      <div className="box pad-lg mb16">
        <div className="row between center wrap gap12">
          <div className="stack gap4">
            <span className="eyebrow">{today}</span>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {todos.length === 0
                ? "You're all caught up"
                : `You have ${todos.length} thing${todos.length === 1 ? '' : 's'} to do today`}
            </div>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              {todos.length === 0
                ? 'Nothing needs you right now. The engine runs again on the next scrape.'
                : 'Everything else ran automatically.'}
            </span>
          </div>
          <div className="row gap8">
            <span className="tag human"><span className="dot" />Your job</span>
            <span className="tag auto"><span className="dot" />AI handled the rest</span>
          </div>
        </div>

        {todos.length > 0 && (
          <div className="g2 mt16">
            {todos.map((t) => (
              <div className="todo" key={t.n}>
                <div className="num">{t.n}</div>
                <div className="grow stack gap6">
                  <div className="row between center">
                    <b style={{ fontSize: 13 }}>{t.title}</b>
                    <span className={`tag ${t.tag.cls}`}><span className="dot" />{t.tag.text}</span>
                  </div>
                </div>
                <Link className="btn human sm" href={t.href}>{t.cta}</Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Onboarding setup — only until the first scrape lands */}
      {!data.lastScrape && <SetupCard userId={user.id} hasProfile={data.hasProfile} />}

      {/* Pipeline */}
      <div className="box pad-lg mb16">
        <div className="row between center" style={{ marginBottom: 6 }}>
          <div className="h-sec">The automation pipeline</div>
          <span className="eyebrow">
            {data.lastScrape?.finished_at
              ? `last run ${relativeTime(data.lastScrape.finished_at)}`
              : 'no runs yet'}
          </span>
        </div>
        <div className="pipe">
          {PIPELINE.map((s) => (
            <div className={`pstep${s.human ? ' human' : ''}`} key={s.label}>
              <div className="nodewrap">
                <div className="node"><span className="gi" /></div>
              </div>
              <div className="plbl">{s.label}</div>
              <div className="pmeta">{s.meta}</div>
            </div>
          ))}
        </div>
        <div className="legend mt12">
          <span><i style={{ background: 'var(--human-soft)', borderColor: 'var(--human-line)' }} />you act</span>
          <span><i style={{ background: 'var(--auto-soft)', borderColor: 'var(--auto-line)' }} />fully automated</span>
        </div>
      </div>

      <div className="g-main">
        {/* Approval queue */}
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

        {/* Up next + trending */}
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
                      <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>
                        {s.idea_hook ? truncate(s.idea_hook, 48) : 'Scheduled post'}
                      </span>
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

function SetupCard({ userId, hasProfile }: { userId: string; hasProfile: boolean }) {
  return (
    <div className="box pad-lg mb16">
      <span className="eyebrow">Get started</span>
      <div className="h-sec mt8">Connect the Chrome extension</div>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 14px' }}>
        Open the LinkedIn CRM extension popup and paste these into its Settings. Then browse your
        LinkedIn activity and hit “Scrape” — the engine takes over from there.
      </p>
      <div style={{ maxWidth: 520 }}>
        <UserIdCopy userId={userId} />
      </div>
      <div className="note mt16">
        Ingest secret = <b>EXTENSION_INGEST_SECRET</b> from web/.env.local · API base URL = your CRM URL.
        {!hasProfile && <> After your first scrape, run <b>AI inference</b> on the Profile screen.</>}
      </div>
    </div>
  )
}
