#!/usr/bin/env node
// End-to-end ingest smoke test.
// Usage: node scripts/test-ingest.mjs <user_id>
// Reads INGEST_URL (default http://localhost:3000/api/ingest) and EXTENSION_INGEST_SECRET from env.

const INGEST_URL = process.env.INGEST_URL ?? 'http://localhost:3000/api/ingest'
const SECRET = process.env.EXTENSION_INGEST_SECRET
const userId = process.argv[2]

if (!SECRET) {
  console.error('Set EXTENSION_INGEST_SECRET in your shell (same value as web/.env.local).')
  process.exit(1)
}
if (!userId) {
  console.error('Usage: node scripts/test-ingest.mjs <user_id>')
  console.error('Find user_id on the /dashboard page after signing up.')
  process.exit(1)
}

const now = new Date()
const iso = now.toISOString()

const batch = {
  startedAt: iso,
  sourcePages: ['https://www.linkedin.com/feed/'],
  people: [
    {
      profileUrl: 'https://www.linkedin.com/in/test-engager',
      fullName: 'Test Engager',
      headline: 'Senior Engineer at Acme',
      isConnection: true,
    },
    {
      profileUrl: 'https://www.linkedin.com/in/test-author',
      fullName: 'Test Author',
      headline: 'Founder at FooLabs',
    },
  ],
  ownPosts: [
    {
      linkedinUrn: 'urn:li:activity:test-own-1',
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:test-own-1',
      postedAt: iso,
      body: 'Smoke test own post — Flutter + Claude workflow tip.',
      media: 'text',
      metrics: { impressions: 1234, likes: 42, comments: 7, reposts: 2 },
    },
  ],
  inspirationPosts: [
    {
      linkedinUrn: 'urn:li:activity:test-inspo-1',
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:test-inspo-1',
      author: { profileUrl: 'https://www.linkedin.com/in/test-author' },
      body: 'Hot take: tools matter less than taste.',
      media: 'text',
      postedAt: iso,
      likes: 800,
      comments: 60,
      reposts: 20,
    },
  ],
  engagements: [
    {
      postUrn: 'urn:li:activity:test-own-1',
      person: { profileUrl: 'https://www.linkedin.com/in/test-engager' },
      type: 'reaction',
      reaction: 'celebrate',
      engagedAt: iso,
    },
    {
      postUrn: 'urn:li:activity:test-own-1',
      person: { profileUrl: 'https://www.linkedin.com/in/test-engager' },
      type: 'comment',
      commentText: 'Great post!',
      engagedAt: iso,
    },
  ],
}

const res = await fetch(INGEST_URL, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${SECRET}`,
    'x-user-id': userId,
  },
  body: JSON.stringify(batch),
})

const text = await res.text()
console.log(`HTTP ${res.status}`)
console.log(text)
process.exit(res.ok ? 0 : 1)
