// Profile page extractor — runs on any https://www.linkedin.com/in/<slug>/* page.
// Returns a ScrapedPersonInput, or null if the page doesn't look like a fully-loaded profile.
//
// Strategy: LinkedIn aggressively obfuscates class names (every name is a random hash like
// `_038c8bff9`). The stable signals are:
//   - <h2> heading text (e.g. "About", "Services", "Featured")
//   - data-testid attributes (carousel, expandable-text-box)
//   - href patterns (/edit/forms/summary/, /feed/followers/, /invite-connect/connections/)
//   - aria-label text on action links
// Selectors anchor on these and walk the tree from there.

import type { ScrapedFeaturedItem, ScrapedPersonInput } from '@crm/shared'
import { canonicalProfileUrl, text } from '../util'

export function extractProfile(): ScrapedPersonInput | null {
  const profileUrl = canonicalProfileUrl(location.href)
  if (!profileUrl) return null

  const fullName = extractName()
  if (!fullName) return null

  const headline = extractHeadline(fullName)
  const bio = extractAbout()
  const location_ = extractLocation(fullName, headline)
  const followerCount = extractFollowerCount() ?? undefined
  const connectionCount = extractConnectionCount() ?? undefined
  const topSkills = extractTopSkills()
  const services = extractServices()
  const featured = extractFeatured()
  const isConnection = detectFirstDegree()

  return {
    profileUrl,
    fullName,
    headline: headline ?? undefined,
    bio: bio ?? undefined,
    location: location_ ?? undefined,
    followerCount,
    connectionCount,
    topSkills: topSkills.length > 0 ? topSkills : undefined,
    services: services.length > 0 ? services : undefined,
    featured: featured.length > 0 ? featured : undefined,
    isConnection,
    raw: {
      capturedAt: new Date().toISOString(),
      href: location.href,
    },
  }
}

// DOM-based self-profile detection. When you're on your OWN profile, LinkedIn renders
// "Edit ..." links (forms/summary/, opportunities/services/edit/, etc.) that don't exist
// on other people's profiles. This is way more reliable than slug matching.
export function isOwnProfilePage(): boolean {
  return Boolean(
    document.querySelector('a[href*="/edit/forms/summary/"]') ||
      document.querySelector('a[href*="/opportunities/services/edit/"]') ||
      document.querySelector('a[aria-label="Edit about" i]'),
  )
}

// ---------- field extractors ----------

function extractName(): string | null {
  // Modern LinkedIn renders the name in the first <h2> in main. Old layout used <h1>.
  const h = document.querySelector<HTMLElement>('main h2, main h1')
  const t = h ? text(h) : ''
  if (t && t.length < 100) return t

  // Fallback: og:title or <title>
  const og = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
  if (og) {
    const name = og.split('|')[0]?.split(' - ')[0]?.trim()
    if (name) return name
  }
  const title = document.title.split('|')[0]?.split(' - ')[0]?.trim()
  return title || null
}

function extractHeadline(name: string): string | null {
  // Strategy: find the topcard section (containing the name h2), collect all <p> elements
  // within it, filter out counters/location/name, then take the longest. The headline is
  // typically the longest meaningful <p> in the topcard.
  const nameH = Array.from(document.querySelectorAll<HTMLElement>('main h2, main h1'))
    .find((h) => text(h) === name)
  const topcard = nameH?.closest('section') ?? nameH?.parentElement?.parentElement ?? document.querySelector('main')
  if (!topcard) return null

  const ps = Array.from(topcard.querySelectorAll<HTMLParagraphElement>('p'))
  const candidates = ps
    .map((p) => text(p))
    .filter((t) => t.length >= 10 && t.length < 400)
    .filter((t) => t !== name)
    .filter((t) => !/^[\d,]+\+?\s+(followers?|connections?|connection)$/i.test(t))
    .filter((t) => !/^Add\s+verification\b/i.test(t))
    .filter((t) => !looksLikeLocation(t))

  if (candidates.length === 0) {
    // Fallback to og:description
    const og = document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content
    if (og && og.length > 10 && og !== name && !og.toLowerCase().includes('linkedin')) return og
    return null
  }

  // Sort by length desc — the longest substantive line in the topcard is the headline.
  candidates.sort((a, b) => b.length - a.length)
  return candidates[0]
}

function extractAbout(): string | null {
  // Find the About section by heading text.
  const aboutH = findSectionHeading('about')
  if (!aboutH) return null
  const section = aboutH.closest('section') ?? aboutH.parentElement?.parentElement?.parentElement
  if (!section) return null

  // The body is in [data-testid="expandable-text-box"]. There's one per post too, so we scope
  // to within the About section.
  const body = section.querySelector('[data-testid="expandable-text-box"]')
  if (body) {
    const t = text(body)
    if (t && t.length > 20) return cleanupBio(t)
  }
  return null
}

function extractLocation(name: string, headline: string | null): string | null {
  // Location is a <p> in the topcard formatted as "City, Region, Country" (1-3 parts).
  // Skip name, headline, counters.
  const ps = Array.from(document.querySelectorAll<HTMLElement>('main p'))
  for (const p of ps) {
    const t = text(p)
    if (!t || t === name || t === headline) continue
    if (looksLikeLocation(t)) return t
  }
  return null
}

function extractFollowerCount(): number | null {
  return findCounter(/^([\d,]+)\s+followers?$/i)
}

function extractConnectionCount(): number | null {
  // "500+ connections" is special: just return 500.
  const ps = Array.from(document.querySelectorAll<HTMLElement>('main p, main span, main a'))
  for (const p of ps) {
    const t = text(p)
    const m = t.match(/^([\d,]+)\+?\s+connections?$/i)
    if (m) return parseInt(m[1].replace(/,/g, ''), 10)
  }
  return null
}

function extractTopSkills(): string[] {
  // Find the <p>Top skills</p> label, then take its next <p> sibling.
  const labels = Array.from(document.querySelectorAll<HTMLElement>('main p'))
  const labelP = labels.find((p) => text(p).toLowerCase() === 'top skills')
  if (!labelP) return []

  const sibling = labelP.nextElementSibling
  if (!sibling) return []
  const skillsText = text(sibling)
  return skillsText
    .split(/\s*[•·|]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 80)
}

function extractServices(): string[] {
  const h = findSectionHeading('services')
  if (!h) return []
  const section = h.closest('section') ?? h.parentElement?.parentElement?.parentElement
  if (!section) return []

  // Services are short <p> tags (each service name is ~3-5 words).
  const all = Array.from(section.querySelectorAll<HTMLElement>('p'))
    .map((p) => text(p))
    .filter((t) => t.length > 0 && t.length < 60)
    .filter((t) => t.toLowerCase() !== 'services')
    .filter((t) => !/show all/i.test(t))

  return Array.from(new Set(all))
}

function extractFeatured(): ScrapedFeaturedItem[] {
  const h = findSectionHeading('featured')
  if (!h) return []
  const section = h.closest('section') ?? h.parentElement?.parentElement?.parentElement
  if (!section) return []

  const items = Array.from(section.querySelectorAll<HTMLElement>('[data-testid="carousel-child-container"]'))
  const out: ScrapedFeaturedItem[] = []
  for (const item of items) {
    // Find the first link inside the item (usually wraps the whole tile)
    const link = item.querySelector<HTMLAnchorElement>('a[href]')
    const url = link?.href

    // The title is typically the first prominent text: a heading or a non-trivial paragraph
    const titleEl = item.querySelector('h2, h3, h4, h5, p, span')
    let title = titleEl ? text(titleEl) : text(item).slice(0, 120)

    // Sometimes the first text node is "Link" / "Post" / "Article" (the kind label) followed
    // by the actual title. Walk paragraphs and take the longest reasonable one.
    const ps = Array.from(item.querySelectorAll<HTMLElement>('p, h3, h4'))
      .map((n) => text(n))
      .filter((t) => t.length > 3 && t.length < 200)
    if (ps.length > 0) {
      ps.sort((a, b) => b.length - a.length)
      title = ps[0] ?? title
    }

    if (title) {
      const kind = inferFeaturedKind(url, item)
      out.push({ title, url: url || undefined, kind })
    }
  }
  return out
}

function detectFirstDegree(): boolean {
  // Scope to the topcard area (first 2-3 sections of main) — the "1st" badge appears
  // immediately near the name on someone else's profile. On own profile, "1st" never appears.
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('main section span, main section div'))
  for (const el of candidates.slice(0, 400)) {
    // Reject if text is too long (false positives like "October 1st").
    const t = text(el)
    if (t === '1st') return true
  }
  return false
}

// ---------- helpers ----------

function findSectionHeading(headingText: string): HTMLElement | null {
  const target = headingText.toLowerCase()
  const all = Array.from(document.querySelectorAll<HTMLElement>('main h2, main h3'))
  return all.find((h) => text(h).toLowerCase() === target) ?? null
}

function looksLikeLocation(t: string): boolean {
  // "City, State, Country" or "City, Country". Each part is words/spaces. Total < 100 chars.
  if (t.length > 100) return false
  if (!t.includes(',')) return false
  const parts = t.split(',').map((p) => p.trim())
  if (parts.length < 2 || parts.length > 4) return false
  return parts.every((p) => /^[\p{L}\s.-]+$/u.test(p) && p.length > 0 && p.length < 60)
}

function findCounter(pattern: RegExp): number | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>('main p, main span, main a'))
  for (const node of all) {
    const m = text(node).match(pattern)
    if (m) return parseInt(m[1].replace(/,/g, ''), 10)
  }
  return null
}

function inferFeaturedKind(url: string | undefined, item: HTMLElement): string {
  if (url) {
    if (/\/feed\/update\//.test(url) || /\/posts\//.test(url)) return 'post'
    if (/\/pulse\//.test(url) || /\/article\//.test(url)) return 'article'
  }
  // Look for the kind label LinkedIn sometimes renders ("Link", "Post", "Article").
  const labelP = Array.from(item.querySelectorAll<HTMLElement>('p, span')).find((n) => {
    const t = text(n)
    return /^(Link|Post|Article|Video|Image)$/i.test(t)
  })
  if (labelP) return text(labelP).toLowerCase()
  return 'link'
}

function cleanupBio(s: string): string {
  return s
    .replace(/\s*…?\s*see\s*more$/i, '')
    .replace(/\s*\.\.\.\s*see\s*more$/i, '')
    .trim()
}
