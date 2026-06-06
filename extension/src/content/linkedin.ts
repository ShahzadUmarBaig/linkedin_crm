// Content script entry point.
// Passively observes the DOM. We never auto-scroll or auto-navigate.

import type { ScrapedPersonInput } from '@crm/shared'
import { getConfig } from '../lib/storage'
import {
  recordEngagement,
  recordInspirationPost,
  recordOwnPost,
  recordPage,
  recordPerson,
  recordSelfProfile,
} from '../lib/buffer'
import { extractProfile, isOwnProfilePage } from './extractors/profile'
import { scanPosts } from './extractors/posts'
import { onUrlChange } from './observer'
import { activityPageSlug, canonicalProfileUrl, isProfilePage, waitFor } from './util'
import { captureDom } from './dom-capture'

// Content-script message listener — handles requests sent from background
// (which in turn relays popup requests targeted at this tab).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'capture-dom-request') {
    try {
      const dom = captureDom({ maxNodes: msg.maxNodes ?? 8000, maxDepth: msg.maxDepth ?? 50 })
      sendResponse({ ok: true, dom, url: location.href })
    } catch (err) {
      sendResponse({ ok: false, error: (err as Error).message })
    }
    return true
  }
  return false
})

let postsObserver: MutationObserver | null = null

async function runExtractors() {
  await recordPage(location.href)

  // Profile pages — capture the topcard immediately, then keep re-extracting as LinkedIn's
  // server-driven UI streams in the About / Top skills / Services / Featured cards (these
  // arrive a beat after the topcard). Route to selfProfile or people based on a DOM signal
  // (presence of "Edit ..." links that only appear on your own profile).
  if (isProfilePage()) {
    await startProfileCapture()
  } else {
    stopProfileCapture()
  }

  // Activity pages — capture posts visible now + as user scrolls.
  const ownerSlug = activityPageSlug()
  if (ownerSlug) {
    await startPostsCapture(ownerSlug)
  } else {
    stopPostsCapture()
  }
}

// ---------- profile capture ----------
// LinkedIn streams profile sections progressively. extractProfile() returns as soon as the
// name (topcard) exists, so a single-shot capture misses the later cards. We re-extract on an
// interval for a bounded window and accumulate the richest snapshot per profile URL — merging
// only non-empty fields so a transient sparse extraction can never wipe a field we already have.

let profileTimer: ReturnType<typeof setInterval> | null = null
const profileAccum: Record<string, ScrapedPersonInput> = {}

function stopProfileCapture() {
  if (profileTimer != null) {
    clearInterval(profileTimer)
    profileTimer = null
  }
}

function mergePerson(prev: ScrapedPersonInput | undefined, next: ScrapedPersonInput): ScrapedPersonInput {
  const out: Record<string, unknown> = { ...(prev ?? {}) }
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out as ScrapedPersonInput
}

async function captureProfileOnce(): Promise<void> {
  const person = extractProfile()
  if (!person) return

  const config = await getConfig()
  const selfSlug = config.selfLinkedinSlug?.trim() || null
  const slugMatch = selfSlug
    ? canonicalProfileUrl(location.href) === `https://www.linkedin.com/in/${selfSlug}/`
    : false
  const isSelf = isOwnProfilePage() || slugMatch

  const key = person.profileUrl ?? canonicalProfileUrl(location.href) ?? location.href
  const merged = mergePerson(profileAccum[key], person)
  profileAccum[key] = merged

  if (isSelf) {
    await recordSelfProfile(merged)
  } else {
    await recordPerson(merged)
  }
  await chrome.storage.local.set({
    lastCapture: {
      kind: isSelf ? 'self-profile' : 'profile',
      name: merged.fullName,
      at: new Date().toISOString(),
    },
  })
}

async function startProfileCapture() {
  stopProfileCapture()

  const first = await waitFor(() => extractProfile(), { timeoutMs: 8000 })
  if (!first) return
  await captureProfileOnce()

  // Keep re-capturing for ~16s so streamed-in cards (About/skills/services/featured) are picked
  // up. Stops early if the user navigates to a different profile.
  const startedUrl = canonicalProfileUrl(location.href)
  const deadline = Date.now() + 16000
  profileTimer = setInterval(() => {
    if (canonicalProfileUrl(location.href) !== startedUrl || Date.now() > deadline) {
      stopProfileCapture()
      return
    }
    void captureProfileOnce()
  }, 1500)
}

async function startPostsCapture(ownerSlug: string) {
  const config = await getConfig()
  const selfSlug = config.selfLinkedinSlug?.trim() || null

  // Wait until at least one post element renders.
  const ready = await waitFor(
    () => document.querySelector('[data-urn^="urn:li:activity:"], [data-urn^="urn:li:ugcPost:"]'),
    { timeoutMs: 10000 },
  )
  if (!ready) {
    console.log('[linkedin-crm] no posts found on activity page after 10s')
    return
  }

  const captureNow = async () => {
    const captures = scanPosts({ pageOwnerSlug: ownerSlug, selfSlug })
    if (captures.length === 0) return
    let totalComments = 0
    for (const c of captures) {
      if (c.author) await recordPerson(c.author)
      if (c.ownPost) await recordOwnPost(c.ownPost)
      if (c.inspirationPost) await recordInspirationPost(c.inspirationPost)
      if (c.comments) {
        for (const { person, engagement } of c.comments) {
          await recordPerson(person)
          await recordEngagement(engagement)
          totalComments++
        }
      }
    }
    await chrome.storage.local.set({
      lastCapture: {
        kind: 'posts',
        name: `${captures.length} post${captures.length === 1 ? '' : 's'} on ${ownerSlug}` +
          (totalComments > 0 ? ` (+${totalComments} comments)` : ''),
        at: new Date().toISOString(),
      },
    })
    console.log(
      `[linkedin-crm] captured ${captures.length} posts (+${totalComments} comments) on ${ownerSlug} (self=${selfSlug})`,
    )
  }

  await captureNow()

  // Re-scan as posts stream in via scroll. Throttle to avoid storming the buffer.
  stopPostsCapture() // tear down previous if URL changed within session
  let scheduled = false
  postsObserver = new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    setTimeout(() => {
      scheduled = false
      // Bail if user has since navigated off the activity page.
      if (activityPageSlug() !== ownerSlug) {
        stopPostsCapture()
        return
      }
      void captureNow()
    }, 1500)
  })
  postsObserver.observe(document.body, { childList: true, subtree: true })
}

function stopPostsCapture() {
  if (postsObserver) {
    postsObserver.disconnect()
    postsObserver = null
  }
}

void runExtractors()
onUrlChange(() => {
  void runExtractors()
})
