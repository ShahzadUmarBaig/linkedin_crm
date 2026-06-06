// Home-feed extractor — runs on https://www.linkedin.com/feed/.
//
// The home feed is rendered with LinkedIn's server-driven UI: class names are random hashes
// and there are NO data-urn attributes or /feed/update/ links on the post elements. The only
// stable signals are:
//   - componentkey="...FeedType_MAIN_FEED_RELEVANCE" wrapping each post
//   - the rendered innerText, whose structure is consistent:
//       [reason]  author  • Nth  headline  8h •  Follow  <body>  more  <counts>  Like Comment …
//   - content images on media.licdn.com/.../feedshare-... (avatars are profile-displayphoto)
//
// Posts here have no URN we can read, so we synthesize a stable dedup key from author + body.

import type { ScrapedInspirationPostInput, ScrapedMediaType, ScrapedPersonInput } from '@crm/shared'
import { canonicalProfileUrl, parseRelativeTime, text } from '../util'

export interface FeedCapture {
  inspirationPost: ScrapedInspirationPostInput
  author?: ScrapedPersonInput
}

export function scanFeed(): FeedCapture[] {
  const out: FeedCapture[] = []
  const seen = new Set<string>()
  for (const el of findFeedContainers()) {
    const cap = extractFeedPost(el)
    if (!cap) continue
    const key = cap.inspirationPost.linkedinUrn!
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cap)
  }
  return out
}

// Outermost post wrappers that actually contain a post (an author link + some text).
function findFeedContainers(): HTMLElement[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>('[componentkey*="FeedType_MAIN_FEED"]'))
  const substantial = all.filter((el) => {
    if (!el.querySelector('a[href*="/in/"]')) return false
    return (el.innerText || '').trim().length > 60
  })
  return substantial.filter((el) => !substantial.some((other) => other !== el && other.contains(el)))
}

function extractFeedPost(el: HTMLElement): FeedCapture | null {
  const lines = (el.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean)
  if (lines.length === 0) return null

  const author = extractAuthor(el)
  const timeIdx = findTimeIndex(lines)
  const postedAt = timeIdx >= 0 ? parseRelativeTime(lines[timeIdx]) : null
  const body = extractBody(lines, timeIdx, author?.fullName)
  if (!author?.profileUrl && !body) return null // nothing useful

  const counts = extractCounts(el.innerText || '')
  const images = extractFeedImages(el)
  const media: ScrapedMediaType = el.querySelector('video') ? 'video' : images.length > 0 ? 'image' : 'text'
  const urn = synthUrn(author?.profileUrl, body, el)

  const inspirationPost: ScrapedInspirationPostInput = {
    linkedinUrn: urn,
    author,
    body: body || undefined,
    media,
    postedAt: postedAt || undefined,
    likes: counts.reactions ?? undefined,
    comments: counts.comments ?? undefined,
    reposts: counts.reposts ?? undefined,
    raw: { capturedAt: new Date().toISOString(), source: 'home_feed', images },
  }
  return { inspirationPost, author }
}

function extractAuthor(el: HTMLElement): ScrapedPersonInput | undefined {
  const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'))
  let nameLink: HTMLAnchorElement | undefined
  for (const a of links) {
    const t = cleanName(text(a))
    if (t && t.length >= 2 && t.length <= 70 && /[a-z]/i.test(t) && !/^follow(ing)?$/i.test(t)) {
      nameLink = a
      break
    }
  }
  const anyLink = nameLink ?? links[0]
  if (!anyLink) return undefined
  const profileUrl = canonicalProfileUrl(anyLink.href) ?? undefined
  if (!profileUrl) return undefined
  const fullName = nameLink ? cleanName(text(nameLink)) : undefined
  return { profileUrl, fullName: fullName || undefined }
}

// Strip a trailing connection degree ("Vlad Svitanko • 2nd" → "Vlad Svitanko") and dedup the
// name LinkedIn sometimes renders twice ("Vlad SvitankoVlad Svitanko").
function cleanName(raw: string): string {
  let s = raw.replace(/\s*•?\s*(1st|2nd|3rd|\+)\b.*$/i, '').trim()
  const half = s.slice(0, s.length / 2).trim()
  if (half.length > 2 && s === half + half) s = half
  return s
}

function findTimeIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // A timestamp chip is short ("8h", "2d •", "3w • Edited"). Require the time token to be
    // most of the line so body sentences starting with a number don't match.
    const stripped = line.replace(/[•·]|edited/gi, '').trim()
    if (stripped.length <= 6 && parseRelativeTime(line) !== null) return i
  }
  return -1
}

const STOP = /(reacted|comments?|reposts?|^like$|^comment$|^repost$|^send$|^load more|^see translation)/i

function extractBody(lines: string[], timeIdx: number, authorName?: string): string {
  // Body sits after the time chip (skip Follow/headline). If we couldn't find the time, fall
  // back to the longest substantial line.
  if (timeIdx < 0) {
    const longest = [...lines].filter((l) => l.length > 40 && !STOP.test(l)).sort((a, b) => b.length - a.length)[0]
    return longest ?? ''
  }
  const collected: string[] = []
  for (let i = timeIdx + 1; i < lines.length; i++) {
    const l = lines[i]
    if (STOP.test(l)) break
    if (/^(follow|following|…?more|more|see more)$/i.test(l)) continue
    if (authorName && l === authorName) continue
    collected.push(l)
  }
  return collected.join('\n').replace(/\s*…?\s*more$/i, '').trim()
}

function extractCounts(textBlob: string): { reactions: number | null; comments: number | null; reposts: number | null } {
  const norm = textBlob.replace(/,/g, '')
  let reactions: number | null = null
  const others = norm.match(/and\s*(\d+)\s*others?/i)
  if (others) reactions = parseInt(others[1], 10) + 1
  else {
    const r = norm.match(/(\d+)\s*reactions?\b/i)
    if (r) reactions = parseInt(r[1], 10)
  }
  const c = norm.match(/(\d+)\s*comments?\b/i)
  const rp = norm.match(/(\d+)\s*reposts?\b/i)
  return {
    reactions,
    comments: c ? parseInt(c[1], 10) : null,
    reposts: rp ? parseInt(rp[1], 10) : null,
  }
}

function extractFeedImages(el: HTMLElement): string[] {
  const urls = new Set<string>()
  el.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    const src = img.currentSrc || img.src || img.getAttribute('data-delayed-url') || ''
    if (isFeedContentImage(src)) urls.add(src)
  })
  return Array.from(urls).slice(0, 6)
}

function isFeedContentImage(src: string): boolean {
  if (!src || src.startsWith('data:') || !/^https?:/.test(src)) return false
  if (/profile-displayphoto|profile-framedphoto|company-logo|EntityPhoto|static\.licdn\.com|\/aero-v1\//i.test(src)) {
    return false
  }
  return true
}

function synthUrn(profileUrl: string | undefined, body: string, el: HTMLElement): string {
  const slug = profileUrl?.match(/\/in\/([^/]+)/)?.[1] ?? ''
  let basis = `${slug}|${body.slice(0, 140)}`.trim()
  if (basis === '|' || basis.length < 3) basis = (el.innerText || '').slice(0, 200)
  return 'feed-' + djb2(basis)
}

function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}
