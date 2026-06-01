// Posts extractor — runs on /in/<slug>/recent-activity/* pages.
// Captures every visible post element. The page slug tells us who authored them; the
// extension's selfLinkedinSlug config tells us whether to record as own or inspiration.
//
// Defensive selectors: `[data-urn^="urn:li:activity:"]` is the most stable signal we have.
// Body/metrics use multiple fallbacks because LinkedIn rotates classnames frequently.

import type {
  ScrapedEngagementInput,
  ScrapedInspirationPostInput,
  ScrapedMediaType,
  ScrapedOwnPostInput,
  ScrapedPersonInput,
} from '@crm/shared'
import { firstText, parseCount, parseRelativeTime, text } from '../util'

export interface PostCapture {
  // Either we recorded it as the user's own post...
  ownPost?: ScrapedOwnPostInput
  // ...or as an inspiration post (with author resolved when possible).
  inspirationPost?: ScrapedInspirationPostInput
  // Author of the post, regardless of own/inspiration. Useful to push into people too.
  author?: ScrapedPersonInput
  // Commenters captured under this post. Each becomes a Person + an Engagement.
  comments?: Array<{ person: ScrapedPersonInput; engagement: ScrapedEngagementInput }>
}

interface ScanContext {
  pageOwnerSlug: string  // who owns the activity page we're scanning
  selfSlug: string | null // the user's own slug, from config (null if not configured)
}

export function scanPosts(ctx: ScanContext): PostCapture[] {
  const postEls = Array.from(
    document.querySelectorAll<HTMLElement>('[data-urn^="urn:li:activity:"], [data-urn^="urn:li:ugcPost:"]'),
  )
  const seen = new Set<string>()
  const captures: PostCapture[] = []

  for (const el of postEls) {
    const urn = el.getAttribute('data-urn')
    if (!urn || seen.has(urn)) continue
    seen.add(urn)

    const capture = extractOnePost(el, urn, ctx)
    if (capture) captures.push(capture)
  }

  return captures
}

function extractOnePost(el: HTMLElement, urn: string, ctx: ScanContext): PostCapture | null {
  const body = extractBody(el)
  const media = detectMediaType(el)
  const postedAt = extractPostedAt(el)
  const metrics = extractMetrics(el)
  const author = extractAuthor(el) ?? ownerAsAuthor(ctx)
  const url = `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`
  const comments = extractComments(el, urn)

  const isOwn = ctx.selfSlug && ctx.pageOwnerSlug === ctx.selfSlug

  if (isOwn) {
    const ownPost: ScrapedOwnPostInput = {
      linkedinUrn: urn,
      url,
      postedAt: postedAt ?? undefined,
      body: body ?? undefined,
      media: media ?? undefined,
      metrics,
      raw: { capturedAt: new Date().toISOString(), pageOwnerSlug: ctx.pageOwnerSlug },
    }
    return { ownPost, author, comments }
  } else {
    const inspirationPost: ScrapedInspirationPostInput = {
      linkedinUrn: urn,
      url,
      author,
      body: body ?? undefined,
      media: media ?? undefined,
      postedAt: postedAt ?? undefined,
      likes: metrics.likes ?? undefined,
      comments: metrics.comments ?? undefined,
      reposts: metrics.reposts ?? undefined,
      raw: { capturedAt: new Date().toISOString(), pageOwnerSlug: ctx.pageOwnerSlug },
    }
    return { inspirationPost, author, comments }
  }
}

function extractBody(el: HTMLElement): string | null {
  return firstText(
    [
      '.update-components-text',
      '.feed-shared-update-v2__description',
      '.feed-shared-text',
      '[data-test-id="main-feed-activity-card"] [dir="ltr"]',
    ],
    el,
  )
}

function detectMediaType(el: HTMLElement): ScrapedMediaType | null {
  if (el.querySelector('.update-components-video, video')) return 'video'
  if (el.querySelector('.update-components-image, img.feed-shared-image__image')) return 'image'
  if (el.querySelector('.update-components-article, [data-test-id="article-card"]')) return 'article'
  if (el.querySelector('.update-components-poll')) return 'poll'
  if (el.querySelector('.update-components-document')) return 'document'
  return 'text'
}

function extractPostedAt(el: HTMLElement): string | null {
  // 1. Try the relative-time spans LinkedIn renders next to the author name.
  const relSelectors = [
    '.update-components-actor__sub-description',
    '.feed-shared-actor__sub-description',
  ]
  for (const sel of relSelectors) {
    const node = el.querySelector(sel)
    if (!node) continue
    const iso = parseRelativeTime(text(node))
    if (iso) return iso
  }

  // 2. Fall back to any <time datetime="..."> inside the post header (some surfaces have it).
  const timeEl = el.querySelector<HTMLTimeElement>('time[datetime]')
  if (timeEl?.dateTime) {
    const d = new Date(timeEl.dateTime)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  return null
}

function extractMetrics(el: HTMLElement): { likes?: number; comments?: number; reposts?: number; impressions?: number } {
  const out: { likes?: number; comments?: number; reposts?: number; impressions?: number } = {}

  // Likes/reactions — usually a button with aria-label "1,234 reactions" or text "1,234".
  const reactionEl = el.querySelector(
    '[data-test-id="social-actions__reactions"], .social-details-social-counts__reactions, .social-details-social-counts__reactions-count',
  )
  const reactionTxt = ariaOrText(reactionEl)
  const likes = parseCount(reactionTxt)
  if (likes != null) out.likes = likes

  // Comments
  const commentEl = el.querySelector(
    '[data-test-id="social-actions__comments"], .social-details-social-counts__comments, .social-details-social-counts__count-value',
  )
  const commentTxt = ariaOrText(commentEl)
  const comments = parseCount(commentTxt)
  if (comments != null) out.comments = comments

  // Reposts
  const repostEl = el.querySelector(
    '[data-test-id="social-actions__reposts"], .social-details-social-counts__reposts',
  )
  const repostTxt = ariaOrText(repostEl)
  const reposts = parseCount(repostTxt)
  if (reposts != null) out.reposts = reposts

  // Impressions (only visible on your own posts — LinkedIn shows "N impressions" near
  // a "View analytics" link). Try the analytics-link aria-label first, then any
  // descendant text matching "<N> impressions".
  const impressions = extractImpressions(el)
  if (impressions != null) out.impressions = impressions

  return out
}

function extractImpressions(el: HTMLElement): number | null {
  // 1. "View analytics" link's aria-label often contains the impressions number.
  const analyticsBtn = el.querySelector<HTMLElement>(
    'a[aria-label*="impression" i], button[aria-label*="impression" i], a[href*="/analytics/"]',
  )
  if (analyticsBtn) {
    const aria = analyticsBtn.getAttribute('aria-label') ?? ''
    const m = aria.match(/([\d,]+)\s*impression/i)
    if (m) return parseInt(m[1].replace(/,/g, ''), 10)
  }

  // 2. Search short text nodes for "<N> impressions". Limit to button/a/span/div leaves to
  //    avoid scanning the whole subtree.
  const candidates = el.querySelectorAll('button, a, span, div, p')
  for (const node of candidates) {
    const t = node.textContent?.trim() ?? ''
    if (t.length === 0 || t.length > 60) continue
    const m = t.match(/^([\d,]+)\s*impressions?$/i)
    if (m) return parseInt(m[1].replace(/,/g, ''), 10)
  }
  return null
}

function extractAuthor(el: HTMLElement): ScrapedPersonInput | null {
  // The author's profile link is typically the first /in/ link inside the post header.
  const a = el.querySelector<HTMLAnchorElement>('.update-components-actor a[href*="/in/"], .feed-shared-actor a[href*="/in/"], a[href*="/in/"]')
  if (!a) return null
  const profileUrl = canonicalize(a.href)
  if (!profileUrl) return null
  const fullName = firstText(
    [
      '.update-components-actor__name',
      '.feed-shared-actor__name',
      '.update-components-actor__title',
    ],
    el,
  ) ?? text(a)
  const headline = firstText(
    [
      '.update-components-actor__description',
      '.feed-shared-actor__description',
    ],
    el,
  ) ?? undefined
  return { profileUrl, fullName: fullName || undefined, headline }
}

function extractComments(
  postEl: HTMLElement,
  postUrn: string,
): Array<{ person: ScrapedPersonInput; engagement: ScrapedEngagementInput }> {
  const out: Array<{ person: ScrapedPersonInput; engagement: ScrapedEngagementInput }> = []
  const commentEls = postEl.querySelectorAll<HTMLElement>(
    'article.comments-comment-entity, .comments-comment-item, [data-id*="comment"]',
  )

  for (const cEl of commentEls) {
    const authorLink = cEl.querySelector<HTMLAnchorElement>('a[href*="/in/"]')
    if (!authorLink) continue
    const profileUrl = canonicalize(authorLink.href)
    if (!profileUrl) continue

    const fullName =
      firstText(
        [
          '.comments-comment-meta__description-title',
          '.comments-post-meta__name-text',
          '.comments-comment-item__author-actor-name',
          '.comments-comment-meta__actor-link span',
        ],
        cEl,
      ) ?? text(authorLink)

    const headline = firstText(
      [
        '.comments-comment-meta__description-subtitle',
        '.comments-post-meta__headline',
      ],
      cEl,
    ) ?? undefined

    const commentText = firstText(
      [
        '.comments-comment-item__main-content',
        '.comments-comment-content__commentary',
        '.update-components-text',
      ],
      cEl,
    )
    // No body → likely an unrendered placeholder or a reaction-only row. Skip.
    if (!commentText) continue

    // Avoid capturing reply rows nested under another comment as if they were on the post.
    // The post's `urn` is on `postEl`; the comment's data-urn refers to the comment itself.
    let engagedAt: string | undefined
    const timeEl = cEl.querySelector<HTMLElement>('time[datetime]')
    if (timeEl) {
      const dt = (timeEl as HTMLTimeElement).dateTime
      if (dt) {
        const d = new Date(dt)
        if (!isNaN(d.getTime())) engagedAt = d.toISOString()
      }
    }
    if (!engagedAt) {
      const relNode = cEl.querySelector(
        '.comments-comment-meta__data, .comments-comment-item__timestamp, time',
      )
      if (relNode) {
        const iso = parseRelativeTime(text(relNode))
        if (iso) engagedAt = iso
      }
    }

    const person: ScrapedPersonInput = {
      profileUrl,
      fullName: fullName || undefined,
      headline,
    }
    const engagement: ScrapedEngagementInput = {
      postUrn,
      person,
      type: 'comment',
      commentText,
      engagedAt,
    }
    out.push({ person, engagement })
  }

  return out
}

function ownerAsAuthor(ctx: ScanContext): ScrapedPersonInput | undefined {
  if (!ctx.pageOwnerSlug) return undefined
  return { profileUrl: `https://www.linkedin.com/in/${ctx.pageOwnerSlug}/` }
}

function ariaOrText(el: Element | null | undefined): string | null {
  if (!el) return null
  const aria = el.getAttribute('aria-label')
  if (aria) return aria
  return text(el) || null
}

function canonicalize(href: string): string | null {
  try {
    const u = new URL(href, location.origin)
    const m = u.pathname.match(/^\/in\/([^/]+)/)
    if (!m) return null
    return `https://www.linkedin.com/in/${m[1]}/`
  } catch {
    return null
  }
}
