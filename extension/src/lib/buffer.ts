// In-memory + persistent buffer for what the content script has observed.
// Content script observes DOM passively as the user browses; popup's "Scrape"
// flushes the buffer to the backend.

import type {
  ScrapeBatch,
  ScrapedEngagementInput,
  ScrapedInspirationPostInput,
  ScrapedOwnPostInput,
  ScrapedPersonInput,
} from '@crm/shared'

const BUFFER_KEY = 'scrapeBuffer'

interface Buffer {
  startedAt: string
  sourcePages: string[]
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
  const stored = await chrome.storage.local.get(BUFFER_KEY)
  return (stored[BUFFER_KEY] as Buffer | undefined) ?? emptyBuffer()
}

async function writeBuffer(buf: Buffer): Promise<void> {
  await chrome.storage.local.set({ [BUFFER_KEY]: buf })
}

export async function recordPage(url: string): Promise<void> {
  const buf = await readBuffer()
  if (!buf.sourcePages.includes(url)) buf.sourcePages.push(url)
  await writeBuffer(buf)
}

export async function recordOwnPost(post: ScrapedOwnPostInput): Promise<void> {
  const buf = await readBuffer()
  buf.ownPosts[post.linkedinUrn] = { ...buf.ownPosts[post.linkedinUrn], ...post }
  await writeBuffer(buf)
}

export async function recordInspirationPost(post: ScrapedInspirationPostInput): Promise<void> {
  if (!post.linkedinUrn) return
  const buf = await readBuffer()
  buf.inspirationPosts[post.linkedinUrn] = { ...buf.inspirationPosts[post.linkedinUrn], ...post }
  await writeBuffer(buf)
}

export async function recordPerson(person: ScrapedPersonInput): Promise<void> {
  const key = person.linkedinUrn ?? person.profileUrl
  if (!key) return
  const buf = await readBuffer()
  buf.people[key] = { ...buf.people[key], ...person }
  await writeBuffer(buf)
}

export async function recordEngagement(e: ScrapedEngagementInput): Promise<void> {
  const buf = await readBuffer()
  buf.engagements.push(e)
  await writeBuffer(buf)
}

export async function snapshotBatch(): Promise<ScrapeBatch> {
  const buf = await readBuffer()
  return {
    startedAt: buf.startedAt,
    sourcePages: buf.sourcePages,
    ownPosts: Object.values(buf.ownPosts),
    inspirationPosts: Object.values(buf.inspirationPosts),
    people: Object.values(buf.people),
    engagements: buf.engagements,
  }
}

export async function clearBuffer(): Promise<void> {
  await chrome.storage.local.set({ [BUFFER_KEY]: emptyBuffer() })
}

export async function bufferStats() {
  const buf = await readBuffer()
  return {
    ownPosts: Object.keys(buf.ownPosts).length,
    inspirationPosts: Object.keys(buf.inspirationPosts).length,
    people: Object.keys(buf.people).length,
    engagements: buf.engagements.length,
    pages: buf.sourcePages.length,
  }
}
