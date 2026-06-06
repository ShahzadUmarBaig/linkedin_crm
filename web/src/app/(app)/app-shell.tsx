'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { logout } from '@/app/actions/auth'

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
  '/profile': ['Profile', 'Your niche, pillars, tone & audience'],
  '/settings': ['Settings', 'API keys, models & budget'],
}

function titleFor(pathname: string): [string, string] {
  const key = Object.keys(TITLES).find((k) => pathname === k || pathname.startsWith(k + '/'))
  return key ? TITLES[key] : ['', '']
}

export function AppShell({
  children,
  email,
  counts,
}: {
  children: React.ReactNode
  email: string
  counts: ShellNavCounts
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

        <div className="navlbl">Account</div>
        <NavItem href="/profile" label="Profile" active={isActive('/profile')} circle />
        <NavItem href="/settings" label="Settings" active={isActive('/settings')} />

        <Autopilot />
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

function Autopilot() {
  // Cosmetic stub — there is no nightly autopilot backend yet. Persist the toggle
  // locally so the UI remembers the user's preference until the engine ships.
  const [on, setOn] = useState(true)
  useEffect(() => {
    const stored = window.localStorage.getItem('autopilot')
    if (stored != null) setOn(stored === '1')
  }, [])
  function toggle() {
    setOn((v) => {
      window.localStorage.setItem('autopilot', v ? '0' : '1')
      return !v
    })
  }
  return (
    <div className="autopill">
      <div className="row">
        <div className="stack" style={{ gap: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Autopilot</span>
          <span className="eyebrow" style={{ fontSize: 9 }}>{on ? 'running nightly' : 'paused'}</span>
        </div>
        <button
          type="button"
          aria-label="Toggle autopilot"
          className={`switch${on ? '' : ' off'}`}
          onClick={toggle}
        >
          <i />
        </button>
      </div>
      <div className="note solid" style={{ marginTop: 10 }}>
        AI does <b>6 of 8</b> steps. You only <b>approve</b> &amp; <b>post</b>.
      </div>
    </div>
  )
}
