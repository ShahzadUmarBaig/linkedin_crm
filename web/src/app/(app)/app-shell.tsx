'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { logout } from '@/app/actions/auth'
import { runAutopilotNowAction, setAutopilotAction } from '@/app/actions/autopilot'
import { relativeTime } from '@/lib/format'

export interface ShellNavCounts {
  ideas: number
  calendar: number
}

const TITLES: Record<string, [string, string]> = {
  '/dashboard': ['Home', 'Your automated content pipeline at a glance'],
  '/ideas': ['Ideas', 'Trend-based ideas — approve one'],
  '/compose': ['Compose', 'Draft text · visual · approve'],
  '/calendar': ['Calendar', 'Approved posts, auto-scheduled'],
  '/analytics': ['Analytics', 'What performed and why'],
  '/signals': ['Signals & data', 'Raw inputs from the extension'],
  '/rss': ['RSS feeds', 'Newsletters & blogs feeding the engine'],
  '/profile': ['Profile', 'Your niche, pillars, tone & audience'],
  '/settings': ['Settings', 'API keys, models & budget'],
  '/chess': ['Chess analyzer', 'Paste a PGN — Stockfish finds your mistakes & best moves'],
}

function titleFor(pathname: string): [string, string] {
  const key = Object.keys(TITLES).find((k) => pathname === k || pathname.startsWith(k + '/'))
  return key ? TITLES[key] : ['', '']
}

export function AppShell({
  children,
  email,
  counts,
  autopilotEnabled,
  lastAutopilotRunAt,
}: {
  children: React.ReactNode
  email: string
  counts: ShellNavCounts
  autopilotEnabled: boolean
  lastAutopilotRunAt: string | null
}) {
  const pathname = usePathname()
  const [title, sub] = titleFor(pathname)
  const initial = (email[0] ?? 'Y').toUpperCase()

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  return (
    <div className="app">
      <aside className="side">
        <Link href="/dashboard" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="mark" />
          <div className="nm">
            CRM<small>content engine</small>
          </div>
        </Link>

        <div className="navlbl">Workspace</div>
        <NavItem href="/dashboard" label="Home" active={isActive('/dashboard')} />
        <NavItem href="/ideas" label="Ideas" active={isActive('/ideas')} circle count={counts.ideas} />
        <NavItem href="/compose" label="Compose" active={isActive('/compose')} />
        <NavItem href="/calendar" label="Calendar" active={isActive('/calendar')} count={counts.calendar} />
        <NavItem href="/analytics" label="Analytics" active={isActive('/analytics')} circle />

        <div className="navlbl">Inputs</div>
        <NavItem href="/signals" label="Signals & data" active={isActive('/signals')} />
        <NavItem href="/rss" label="RSS feeds" active={isActive('/rss')} circle />

        <div className="navlbl">Account</div>
        <NavItem href="/profile" label="Profile" active={isActive('/profile')} circle />
        <NavItem href="/settings" label="Settings" active={isActive('/settings')} />

        <div className="navlbl">Personal</div>
        <NavItem href="/chess" label="Chess analyzer" active={isActive('/chess')} circle />

        <Autopilot enabled={autopilotEnabled} lastRunAt={lastAutopilotRunAt} />
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <div className="title">{title}</div>
            <div className="sub">{sub}</div>
          </div>
          <div className="search">
            <span className="ico c" style={{ width: 12, height: 12 }} />
            Search posts, ideas…
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="avatar"
              title={`${email} — sign out`}
              style={{ cursor: 'pointer', padding: 0 }}
            >
              {initial}
            </button>
          </form>
        </div>
        <div className="content">{children}</div>
      </main>
    </div>
  )
}

function NavItem({
  href,
  label,
  active,
  circle,
  count,
}: {
  href: string
  label: string
  active: boolean
  circle?: boolean
  count?: number
}) {
  return (
    <Link href={href} className={`nav${active ? ' active' : ''}`}>
      <span className={`ni${circle ? ' c' : ''}`} />
      {label}
      {count != null && count > 0 && <span className="cnt">{count}</span>}
    </Link>
  )
}

function Autopilot({ enabled, lastRunAt }: { enabled: boolean; lastRunAt: string | null }) {
  const router = useRouter()
  const [on, setOn] = useState(enabled)
  const [saving, startSave] = useTransition()
  const [running, startRun] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  function toggle() {
    const next = !on
    setOn(next) // optimistic
    startSave(async () => {
      const r = await setAutopilotAction(next)
      if (r.error) {
        setOn(!next) // revert
        setMsg(r.error)
      } else {
        router.refresh()
      }
    })
  }

  function runNow() {
    setMsg(null)
    startRun(async () => {
      const r = await runAutopilotNowAction()
      if ('error' in r) return setMsg(r.error)
      setMsg(
        r.ideasGenerated > 0
          ? `Generated ${r.ideasGenerated} idea${r.ideasGenerated === 1 ? '' : 's'}.`
          : r.ideasSkippedReason ?? 'Queue already full.',
      )
      router.refresh()
    })
  }

  return (
    <div className="autopill">
      <div className="row">
        <div className="stack" style={{ gap: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Autopilot</span>
          <span className="eyebrow" style={{ fontSize: 9 }}>
            {on ? (lastRunAt ? `ran ${relativeTime(lastRunAt)}` : 'running nightly') : 'paused'}
          </span>
        </div>
        <button
          type="button"
          aria-label="Toggle autopilot"
          className={`switch${on ? '' : ' off'}`}
          onClick={toggle}
          disabled={saving}
        >
          <i />
        </button>
      </div>
      <div className="note solid" style={{ marginTop: 10 }}>
        AI does <b>6 of 8</b> steps. You only <b>approve</b> &amp; <b>post</b>.
      </div>
      <button
        type="button"
        className="btn ghost sm"
        style={{ width: '100%', marginTop: 8 }}
        onClick={runNow}
        disabled={running}
      >
        {running ? 'Running…' : 'Run now'}
      </button>
      {msg && <div className="eyebrow" style={{ marginTop: 6, textTransform: 'none', letterSpacing: 0, color: 'var(--muted)' }}>{msg}</div>}
    </div>
  )
}
