// In-memory + persistent buffer for what the content script has observed.
// Content script observes DOM passively as the user browses; popup's "Scrape"
// flushes the buffer to the backend.
//
// All mutating ops are funnelled through `enqueue()` which chains them onto a single
// promise. This serializes read-modify-write so concurrent extractor runs (e.g. multiple
// MutationObserver ticks during fast scrolling) can't race and overwrite each other.

import type {
  ScrapeBatch,
  ScrapedEngagementInput,
  ScrapedInspirationPostInput,
  ScrapedOwnPostInput,
  ScrapedPersonInput,
} from '@crm/shared'
import { isExtensionAlive } from './storage'

const BUFFER_KEY = 'scrapeBuffer'

interface Buffer {
  startedAt: string
  sourcePages: string[]
  selfProfile?: ScrapedPersonInput
  ownPosts: Record<string, ScrapedOwnPostInput>           // keyed by linkedinUrn
  inspirationPosts: Record<string, ScrapedInspirationPostInput>
  people: Record<string, ScrapedPersonInput>              // keyed by profileUrl or urn
  engagements: ScrapedEngagementInput[]
}

function emptyBuffer(): Buffer {
  return {
    startedAt: new Date().toISOString(),
    sourcePages: [],
    ownPosts: {},
    inspirationPosts: {},
    people: {},
    engagements: [],
  }
}

async function readBuffer(): Promise<Buffer> {
  if (!isExtensionAlive()) return emptyBuffer()
  try {
    const stored = await chrome.storage.local.get(BUFFER_KEY)
    return (stored[BUFFER_KEY] as Buffer | undefined) ?? emptyBuffer()
  } catch {
    // Context invalidated mid-flight (extension reloaded). Treat as empty; the live content
    // script in the surviving context owns the real buffer.
    return emptyBuffer()
  }
}

async function writeBuffer(buf: Buffer): Promise<void> {
  if (!isExtensionAlive()) return
  try {
    await chrome.storage.local.set({ [BUFFER_KEY]: buf })
  } catch {
    // Swallow "Extension context invalidated" — nothing to write to anymore.
  }
}

// Serialize all buffer mutations onto a single promise chain.
// Without this, two concurrent record*() calls can both read the same buffer state and
// race on the write — losing whichever finishes first.
let writeChain: Promise<void> = Promise.resolve()

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  // Chain a new task; swallow upstream errors so one failure doesn't poison the queue,
  // but keep this task's result/error surfaced to its caller.
  const next = writeChain.then(() => fn(), () => fn())
  writeChain = next.then(
    () => undefined,
    (err) => {
      console.error('[linkedin-crm] buffer write failed', err)
    },
  )
  return next
}

export function recordPage(url: string): Promise<void> {
  return enqueue(async () => {
    const buf = await readBuffer()
    if (!buf.sourcePages.includes(url)) buf.sourcePages.push(url)
    await writeBuffer(buf)
  })
}

export function recordOwnPost(post: ScrapedOwnPostInput): Promise<void> {
  return enqueue(async () => {
    const buf = await readBuffer()
    buf.ownPosts[post.linkedinUrn] = { ...buf.ownPosts[post.linkedinUrn], ...post }
    await writeBuffer(buf)
  })
}

export function recordInspirationPost(post: ScrapedInspirationPostInput): Promise<void> {
  if (!post.linkedinUrn) return Promise.resolve()
  return enqueue(async () => {
    const buf = await readBuffer()
    buf.inspirationPosts[post.linkedinUrn!] = { ...buf.inspirationPosts[post.linkedinUrn!], ...post }
    await writeBuffer(buf)
  })
}

export function recordPerson(person: ScrapedPersonInput): Promise<void> {
  const key = person.linkedinUrn ?? person.profileUrl
  if (!key) return Promise.resolve()
  return enqueue(async () => {
    const buf = await readBuffer()
    buf.people[key] = { ...buf.people[key], ...person }
    await writeBuffer(buf)
  })
}

// Called only when the captured profile is the user's own. Stored in a dedicated slot so
// the server can sync it into `profile` (not `people`).
export function recordSelfProfile(person: ScrapedPersonInput): Promise<void> {
  return enqueue(async () => {
    const buf = await readBuffer()
    buf.selfProfile = { ...buf.selfProfile, ...person }
    await writeBuffer(buf)
  })
}

export function recordEngagement(e: ScrapedEngagementInput): Promise<void> {
  return enqueue(async () => {
    const buf = await readBuffer()
    buf.engagements.push(e)
    await writeBuffer(buf)
  })
}

// Reads do NOT go through the queue — they're idempotent and we always want fresh data.
// But snapshot() should wait for any pending writes to finish so the buffer it returns
// includes everything that's been recorded so far.
export async function snapshotBatch(): Promise<ScrapeBatch> {
  await writeChain
  const buf = await readBuffer()
  return {
    startedAt: buf.startedAt,
    sourcePages: buf.sourcePages,
    selfProfile: buf.selfProfile,
    ownPosts: Object.values(buf.ownPosts),
    inspirationPosts: Object.values(buf.inspirationPosts),
    people: Object.values(buf.people),
    engagements: buf.engagements,
  }
}

export function clearBuffer(): Promise<void> {
  return enqueue(async () => {
    await chrome.storage.local.set({ [BUFFER_KEY]: emptyBuffer() })
  })
}

export async function bufferStats() {
  await writeChain
  const buf = await readBuffer()
  return {
    ownPosts: Object.keys(buf.ownPosts).length,
    inspirationPosts: Object.keys(buf.inspirationPosts).length,
    people: Object.keys(buf.people).length,
    engagements: buf.engagements.length,
    pages: buf.sourcePages.length,
  }
}
