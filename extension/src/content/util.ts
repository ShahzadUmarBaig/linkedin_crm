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
