// Payload shapes the extension sends to the web app's /api/ingest endpoint.
// Keep these dumb data carriers — no logic. Both sides import from here.

export type ScrapedMediaType = 'text' | 'image' | 'video' | 'article' | 'poll' | 'document'
export type ScrapedEngagementType = 'reaction' | 'comment' | 'repost'

export interface ScrapedFeaturedItem {
  title: string
  url?: string
  kind?: string  // 'link' | 'post' | 'article' | inferred from URL/context
}

export interface ScrapedPersonInput {
  linkedinUrn?: string
  profileUrl?: string
  fullName?: string
  headline?: string
  company?: string
  isConnection?: boolean
  // LinkedIn "About" section text. Single richest voice signal — captured on profile pages.
  bio?: string
  // Topcard data
  location?: string
  followerCount?: number
  connectionCount?: number
  // About-adjacent enrichment
  topSkills?: string[]      // ['Product Management', 'SaaS', ...]
  services?: string[]       // ['Mobile App Dev', 'SaaS Dev', ...]
  featured?: ScrapedFeaturedItem[]  // self-curated highlights
  raw?: unknown
}

export interface ScrapedOwnPostInput {
  linkedinUrn: string
  url?: string
  postedAt?: string // ISO
  body?: string
  media?: ScrapedMediaType
  metrics?: {
    impressions?: number
    likes?: number
    comments?: number
    reposts?: number
  }
  raw?: unknown
}

export interface ScrapedInspirationPostInput {
  linkedinUrn?: string
  url?: string
  author?: ScrapedPersonInput
  body?: string
  media?: ScrapedMediaType
  postedAt?: string
  likes?: number
  comments?: number
  reposts?: number
  raw?: unknown
}

export interface ScrapedEngagementInput {
  postUrn: string // matches scraped post's linkedin_urn
  person: ScrapedPersonInput
  type: ScrapedEngagementType
  reaction?: string
  commentText?: string
  engagedAt?: string
}

export interface ScrapeBatch {
  startedAt: string
  sourcePages: string[]
  // The user's own LinkedIn profile data, captured the last time they visited their own profile.
  // The server syncs this into `profile` (display_name, headline, linkedin_url), leaving the
  // AI-inferred fields (niche, audience, tone, pillars) untouched.
  selfProfile?: ScrapedPersonInput
  ownPosts: ScrapedOwnPostInput[]
  inspirationPosts: ScrapedInspirationPostInput[]
  people: ScrapedPersonInput[]
  engagements: ScrapedEngagementInput[]
}
