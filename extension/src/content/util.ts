// DOM helpers used by extractors. Keep tiny and defensive — LinkedIn's markup mutates often,
// so every extractor should layer fallbacks rather than relying on one selector.

export function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim().replace(/\s+/g, ' ')
}

export function meta(property: string): string | null {
  const el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"], meta[name="${property}"]`)
  return el?.content?.trim() || null
}

// Try a list of selectors, return text from the first that resolves to non-empty content.
export function firstText(selectors: string[], root: ParentNode = document): string | null {
  for (const sel of selectors) {
    const el = root.querySelector(sel)
    const t = text(el)
    if (t) return t
  }
  return null
}

// Wait until `condition()` is truthy or timeout. Resolves to whatever `condition` returns.
export function waitFor<T>(condition: () => T | null | undefined, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<T | null> {
  const timeoutMs = opts.timeoutMs ?? 8000
  const intervalMs = opts.intervalMs ?? 250
  return new Promise((resolve) => {
    const start = Date.now()
    const initial = condition()
    if (initial) return resolve(initial)
    const id = setInterval(() => {
      const v = condition()
      if (v) {
        clearInterval(id)
        resolve(v)
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id)
        resolve(null)
      }
    }, intervalMs)
  })
}

// Normalize a LinkedIn profile URL into its canonical form: https://www.linkedin.com/in/<slug>/
// Strips query/hash/sub-paths so /in/<slug>/recent-activity/all/ dedupes with /in/<slug>/.
export function canonicalProfileUrl(href: string): string | null {
  try {
    const url = new URL(href)
    if (!/(^|\.)linkedin\.com$/.test(url.hostname)) return null
    const match = url.pathname.match(/^\/in\/([^/]+)/)
    if (!match) return null
    return `https://www.linkedin.com/in/${match[1]}/`
  } catch {
    return null
  }
}

export function isProfilePage(href: string = location.href): boolean {
  return canonicalProfileUrl(href) !== null
}

// True on the home feed (https://www.linkedin.com/feed/ or /feed), where other people's
// posts stream in. This is the main inspiration-post source.
export function isFeedPage(href: string = location.href): boolean {
  try {
    const url = new URL(href)
    if (!/(^|\.)linkedin\.com$/.test(url.hostname)) return false
    return /^\/feed\/?$/.test(url.pathname)
  } catch {
    return false
  }
}

// Returns the LinkedIn slug whose activity page we're on, or null if not on one.
// Matches /in/<slug>/recent-activity[/<tab>] — covers /all, /posts, /comments, etc.
export function activityPageSlug(href: string = location.href): string | null {
  try {
    const url = new URL(href)
    if (!/(^|\.)linkedin\.com$/.test(url.hostname)) return null
    const m = url.pathname.match(/^\/in\/([^/]+)\/recent-activity(\/|$)/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

// Click in-place "…more" / "see more" expanders inside a post so the full body text is in the
// DOM before we read it. LinkedIn collapses long posts and only renders the rest on click.
// Scoped to commentary expanders — we skip "see more comments/replies" so we don't load threads.
// This is the one interaction the content script performs, and only during an active scrape.
export function expandTruncatedText(root: HTMLElement): void {
  const candidates = root.querySelectorAll<HTMLElement>('button, [role="button"]')
  candidates.forEach((el) => {
    const t = (el.textContent ?? '').trim().toLowerCase()
    const isExpander = t === '…more' || t === '...more' || t === 'see more' || t === '…see more'
    if (!isExpander) return
    if (t.includes('comment') || t.includes('repl')) return
    try {
      el.click()
    } catch {
      /* ignore — expander may have detached */
    }
  })
}

// Convert LinkedIn's relative time strings into an absolute ISO date, best-effort.
// Handles all the units LinkedIn ships in the wild:
//   - seconds: "5s", "30sec", "1 second"
//   - minutes: "1m", "5min", "10 minutes"
//   - hours:   "1h", "2hr", "3 hours"
//   - days:    "1d", "2 days"
//   - weeks:   "1w", "2wk", "3 weeks"
//   - months:  "1mo", "3mos", "4 months"
//   - years:   "1y", "2yr", "3yrs", "5 years"
//   - special: "now", "just now"
// Returns null on unrecognized input so the caller can fall back.
const RELATIVE_UNITS: Array<[RegExp, number]> = [
  // Order: try longer/more-specific first within each group via greedy regex; group order doesn't
  // matter because the input must match exactly one unit.
  [/^(\d+)\s*(?:s|sec|secs|second|seconds)$/i,              1_000],
  [/^(\d+)\s*(?:m|min|mins|minute|minutes)$/i,              60_000],
  [/^(\d+)\s*(?:h|hr|hrs|hour|hours)$/i,                    3_600_000],
  [/^(\d+)\s*(?:d|day|days)$/i,                             86_400_000],
  [/^(\d+)\s*(?:w|wk|wks|week|weeks)$/i,                    7 * 86_400_000],
  [/^(\d+)\s*(?:mo|mos|mon|mons|month|months)$/i,           30 * 86_400_000],
  [/^(\d+)\s*(?:y|yr|yrs|year|years)$/i,                    365 * 86_400_000],
]

export function parseRelativeTime(raw: string, now: Date = new Date()): string | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s === 'now' || s.includes('just now')) return now.toISOString()

  // LinkedIn often surrounds the time with extra metadata: "4mo • Edited" or "1yr •".
  // Try the first whitespace/bullet-delimited token first, then the whole string.
  const tokens = [s.split(/[•·\s]+/).filter(Boolean)[0], s]
  for (const token of tokens) {
    if (!token) continue
    for (const [regex, ms] of RELATIVE_UNITS) {
      const m = token.match(regex)
      if (!m) continue
      const n = parseInt(m[1], 10)
      return new Date(now.getTime() - n * ms).toISOString()
    }
  }
  return null
}

// Extract a leading integer from text like "1,234 reactions" → 1234, "56 comments" → 56.
export function parseCount(s: string | null | undefined): number | null {
  if (!s) return null
  const m = s.replace(/,/g, '').match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}
