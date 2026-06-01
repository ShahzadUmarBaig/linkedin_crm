// Content script entry point.
// Passively observes the DOM. We never auto-scroll or auto-navigate.

import { getConfig } from '../lib/storage'
import {
  recordEngagement,
  recordInspirationPost,
  recordOwnPost,
  recordPage,
  recordPerson,
} from '../lib/buffer'
import { extractProfile } from './extractors/profile'
import { scanPosts } from './extractors/posts'
import { onUrlChange } from './observer'
import { activityPageSlug, isProfilePage, waitFor } from './util'

let postsObserver: MutationObserver | null = null

async function runExtractors() {
  await recordPage(location.href)

  // Profile pages — capture the topcard.
  if (isProfilePage()) {
    const person = await waitFor(() => extractProfile(), { timeoutMs: 8000 })
    if (person) {
      await recordPerson(person)
      await chrome.storage.local.set({
        lastCapture: { kind: 'profile', name: person.fullName, at: new Date().toISOString() },
      })
      console.log('[linkedin-crm] captured profile', person.fullName)
    }
  }

  // Activity pages — capture posts visible now + as user scrolls.
  const ownerSlug = activityPageSlug()
  if (ownerSlug) {
    await startPostsCapture(ownerSlug)
  } else {
    stopPostsCapture()
  }
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
