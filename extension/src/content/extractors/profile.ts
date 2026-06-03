// Profile page extractor — runs on any https://www.linkedin.com/in/<slug>/* page.
// Returns a ScrapedPersonInput, or null if the page doesn't look like a fully-loaded profile.
//
// Strategy: og: meta tags are the most stable signal LinkedIn ships, but they often hold the
// page TITLE which may include name + headline. DOM h1 + the headline div are used to refine.
// Every selector is wrapped in a fallback chain.

import type { ScrapedPersonInput } from '@crm/shared'
import { canonicalProfileUrl, firstText, meta, text } from '../util'

export function extractProfile(): ScrapedPersonInput | null {
  const profileUrl = canonicalProfileUrl(location.href)
  if (!profileUrl) return null

  const fullName = extractName()
  if (!fullName) return null

  const headline = extractHeadline(fullName)
  const company = extractCompany()
  const isConnection = detectFirstDegree()
  const bio = extractAbout()

  return {
    profileUrl,
    fullName,
    headline: headline ?? undefined,
    company: company ?? undefined,
    isConnection,
    bio: bio ?? undefined,
    raw: {
      capturedAt: new Date().toISOString(),
      href: location.href,
      ogTitle: meta('og:title'),
      ogDescription: meta('og:description'),
    },
  }
}

function extractName(): string | null {
  // 1. Top card h1 — most direct.
  const h1 = firstText([
    'main h1',
    'section h1',
    'h1.text-heading-xlarge',
    'h1',
  ])
  if (h1) return h1

  // 2. og:title is "<Name> | LinkedIn" or "<Name> - <Headline> | LinkedIn"
  const og = meta('og:title')
  if (og) {
    const name = og.split('|')[0]?.split(' - ')[0]?.trim()
    if (name) return name
  }

  // 3. <title> fallback
  const t = document.title.split('|')[0]?.split(' - ')[0]?.trim()
  return t || null
}

function extractHeadline(name: string): string | null {
  // The headline is usually the next sibling div after the h1, classed as text-body-medium.
  const sel = [
    'main .text-body-medium.break-words',
    'main section .text-body-medium',
    'section .text-body-medium.break-words',
    '.pv-text-details__left-panel .text-body-medium',
  ]
  const direct = firstText(sel)
  if (direct && direct !== name) return direct

  // og:description sometimes carries the headline.
  const og = meta('og:description')
  if (og && !og.toLowerCase().includes('linkedin')) return og

  return null
}

function extractCompany(): string | null {
  // The top card's "current position" button: typically an <a> or <button> linking to the company.
  const candidates = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('main a[href*="/company/"], a[data-field="experience_company_logo"]'),
  )
  for (const a of candidates) {
    const t = text(a)
    if (t && t.length < 80) return t
  }
  return null
}

function extractAbout(): string | null {
  // Strategy: find a <section> whose heading text is "About", then capture the long-form
  // text within it. LinkedIn uses an aria-hidden span to hold the actual text (the visible
  // copy) and a duplicate visually-hidden span for screen readers.

  // 1. Direct selectors LinkedIn has used historically.
  const direct = firstText(
    [
      'section[data-section="summary"] .display-flex .full-width span[aria-hidden="true"]',
      'section[data-section="summary"] .inline-show-more-text',
      'section#about ~ * .inline-show-more-text',
      '[data-view-name="profile-card"] .inline-show-more-text',
    ],
  )
  if (direct && direct.length > 30) return cleanupBio(direct)

  // 2. Find any <section> whose first h2/h3/heading text === "About"
  const sections = Array.from(document.querySelectorAll<HTMLElement>('main section, main div[data-view-name="profile-card"]'))
  for (const section of sections) {
    const heading = section.querySelector('h2, h3, [aria-level]')
    if (!heading) continue
    const headingText = text(heading).toLowerCase()
    if (headingText !== 'about') continue

    // Look for the most likely body container inside this section.
    const body = firstText(
      [
        '.inline-show-more-text',
        '.display-flex .full-width span[aria-hidden="true"]',
        'span[aria-hidden="true"]',
        '.pv-shared-text-with-see-more',
      ],
      section,
    )
    if (body && body.length > 30) return cleanupBio(body)

    // Fallback: take the whole section's text, strip the heading.
    const wholeText = text(section)
    if (wholeText.length > 30) {
      const stripped = wholeText.replace(/^about\s*/i, '').trim()
      if (stripped.length > 30) return cleanupBio(stripped)
    }
  }

  return null
}

function cleanupBio(s: string): string {
  // LinkedIn's "see more" toggle: text often ends with "…see more" or "see more". Strip.
  return s
    .replace(/\s*…?\s*see more$/i, '')
    .replace(/\s*\.\.\.see more$/i, '')
    .trim()
}

function detectFirstDegree(): boolean {
  // LinkedIn renders a "1st" badge near the name. We look for an element whose text is exactly "1st"
  // and that lives somewhere near the topcard. Simple but stable enough.
  const candidates = Array.from(document.querySelectorAll('main span, main div'))
  for (const el of candidates) {
    if (text(el) === '1st') return true
  }
  return false
}
