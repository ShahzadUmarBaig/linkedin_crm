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
import { expandTruncatedText, firstText, parseCount, parseRelativeTime, text } from '../util'

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

    // Expand "…more" so we capture the full post body (own-post bodies feed drafting).
    expandTruncatedText(el)

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
  const images = extractMediaUrls(el)
  const raw = { capturedAt: new Date().toISOString(), pageOwnerSlug: ctx.pageOwnerSlug, images }

  const isOwn = ctx.selfSlug && ctx.pageOwnerSlug === ctx.selfSlug

  if (isOwn) {
    const ownPost: ScrapedOwnPostInput = {
      linkedinUrn: urn,
      url,
      postedAt: postedAt ?? undefined,
      body: body ?? undefined,
      media: media ?? undefined,
      metrics,
      raw,
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
      raw,
    }
    return { inspirationPost, author, comments }
  }
}

// Pull content image / video-poster URLs from a post's media containers. Scoped to the media
// area so we never pick up the author avatar, reaction icons, or static UI assets.
function extractMediaUrls(el: HTMLElement): string[] {
  const urls = new Set<string>()

  const imgSelectors = [
    '.update-components-image img',
    'img.feed-shared-image__image',
    '.feed-shared-image img',
    '.update-components-article__image img',
    '.feed-shared-article__image img',
    '.update-components-linkedin-video img', // video thumbnail
  ].join(', ')
  el.querySelectorAll<HTMLImageElement>(imgSelectors).forEach((img) => {
    const src = img.currentSrc || img.src || img.getAttribute('data-delayed-url') || ''
    if (isContentImage(src)) urls.add(src)
  })

  el.querySelectorAll<HTMLVideoElement>('.update-components-video video, video').forEach((v) => {
    if (v.poster && isContentImage(v.poster)) urls.add(v.poster)
  })

  return Array.from(urls).slice(0, 8)
}

function isContentImage(src: string): boolean {
  if (!src || src.startsWith('data:') || !/^https?:/.test(src)) return false
  // Exclude avatars, company logos, reaction icons, and static UI sprites.
  if (/profile-displayphoto|profile-framedphoto|company-logo|EntityPhoto|static\.licdn\.com|\/aero-v1\/|reactions?-/i.test(src)) {
    return false
  }
  return true
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
  // Impressions appear in three places, in roughly increasing fragility:
  //   (a) aria-label of the analytics button (most stable)
  //   (b) text content of the analytics summary container
  //   (c) loose text node anywhere in the post matching "<N> impressions"
  // We try all three and accept the first hit.

  const re = /([\d,]+)\s*impressions?/i

  // (a) Any element whose aria-label mentions impressions.
  const ariaCandidates = el.querySelectorAll('[aria-label*="impression" i], [aria-label*="Impression" i]')
  for (const node of ariaCandidates) {
    const m = (node.getAttribute('aria-label') ?? '').match(re)
    if (m) return parseInt(m[1].replace(/,/g, ''), 10)
  }

  // (b) Analytics summary containers LinkedIn has used in the wild.
  const summary = el.querySelector(
    '.feed-shared-update-v2__analytics-summary, .update-v2-social-activity, [data-test-id*="analytics"]',
  )
  if (summary) {
    const m = (summary.textContent ?? '').match(re)
    if (m) return parseInt(m[1].replace(/,/g, ''), 10)
  }

  // (c) Loose text-node scan over leaf-ish elements. Reject very long texts to avoid
  //     matching unrelated body content that mentions "impressions".
  const candidates = el.querySelectorAll('button, a, span, div, p, strong')
  for (const node of candidates) {
    const t = node.textContent?.trim() ?? ''
    if (t.length === 0 || t.length > 80) continue
    const m = t.match(re)
    if (!m) continue
    // Sanity check: the match should constitute most of the element's text, not be buried
    // inside a paragraph that happens to use the word "impressions".
    if (m[0].length / t.length < 0.3) continue
    return parseInt(m[1].replace(/,/g, ''), 10)
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

  // Most-stable signal: anything with a data-id / data-urn containing 'urn:li:comment:'.
  // Falls back to LinkedIn's class-named selectors.
  const commentSelectors = [
    '[data-id*="urn:li:comment:"]',
    '[data-urn*="urn:li:comment:"]',
    'article.comments-comment-entity',
    'article.comments-comment-item',
    '.comments-comment-entity',
    '.comments-comment-item',
  ]
  const seen = new Set<Element>()
  const commentEls: HTMLElement[] = []
  for (const sel of commentSelectors) {
    postEl.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (!seen.has(el)) {
        seen.add(el)
        commentEls.push(el)
      }
    })
  }

  for (const cEl of commentEls) {
    const authorLink = cEl.querySelector<HTMLAnchorElement>('a[href*="/in/"]')
    if (!authorLink) continue
    const profileUrl = canonicalize(authorLink.href)
    if (!profileUrl) continue

    const fullName =
      firstText(
        [
          '.comments-comment-meta__description-title',
          '.comments-comment-meta__name-text',
          '.comments-post-meta__name-text',
          '.comments-comment-item__author-actor-name',
          '.comments-comment-meta__actor-link span[aria-hidden="true"]',
          '.comments-comment-meta__actor-link span',
        ],
        cEl,
      ) ?? text(authorLink)

    const headline =
      firstText(
        [
          '.comments-comment-meta__description-subtitle',
          '.comments-comment-meta__headline',
          '.comments-post-meta__headline',
        ],
        cEl,
      ) ?? undefined

    const commentText = firstText(
      [
        '.comments-comment-item__main-content',
        '.comments-comment-content__commentary',
        '.comments-comment-item-content-body',
        '.update-components-text',
        '.feed-shared-text',
        'span[dir="ltr"]',
      ],
      cEl,
    )
    if (!commentText) continue

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
