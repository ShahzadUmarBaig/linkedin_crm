// Server-only. Persists a ScrapeBatch into Supabase using the service-role client.
// Order matters: people → own posts (+snapshots) → inspiration posts → engagements,
// because later inserts reference earlier IDs.

// NOTE: server-only file — imports the Supabase service-role client, which must never reach the browser.
import type {
  ScrapeBatch,
  ScrapedEngagementInput,
  ScrapedInspirationPostInput,
  ScrapedOwnPostInput,
  ScrapedPersonInput,
} from '@crm/shared'
import { createSupabaseServiceClient } from './supabase/server'
import { attributePostedDrafts } from './attribution'

// Guard every scraped count before it hits a Postgres int column. A parse slip (e.g. a
// LinkedIn URN/id read as a like count) can produce absurd values that overflow int and 500
// the whole ingest — reject anything implausible instead of letting one bad post block a scrape.
const MAX_PLAUSIBLE_COUNT = 100_000_000
function safeInt(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null
  const n = Math.trunc(v)
  if (n < 0 || n > MAX_PLAUSIBLE_COUNT) return null
  return n
}

export interface IngestResult {
  scrapeRunId: string
  counts: {
    peopleUpserted: number
    ownPostsUpserted: number
    metricSnapshotsInserted: number
    inspirationPostsUpserted: number
    engagementsUpserted: number
    skipped: {
      peopleMissingProfileUrl: number
      engagementsMissingPost: number
      engagementsMissingPerson: number
    }
  }
}

type Supa = ReturnType<typeof createSupabaseServiceClient>

export async function ingestBatch(userId: string, batch: ScrapeBatch): Promise<IngestResult> {
  const supabase = createSupabaseServiceClient()

  const { data: run, error: runErr } = await supabase
    .from('scrape_runs')
    .insert({
      user_id: userId,
      started_at: batch.startedAt,
      source_pages: batch.sourcePages,
      status: 'running',
    })
    .select('id')
    .single()

  if (runErr || !run) throw new Error(`scrape_runs insert failed: ${runErr?.message}`)
  const scrapeRunId: string = run.id

  try {
    // 0. Sync self profile into the `profile` table if the extension captured it.
    if (batch.selfProfile) {
      await syncSelfProfile(supabase, userId, batch.selfProfile)
    }

    // 1. People — keyed by profile_url. People without profile_url are skipped.
    const allPeople = collectPeople(batch)
    const peopleIdByKey = await upsertPeople(supabase, userId, allPeople)

    // 2. Own posts + metric snapshots
    const { postIdByUrn, ownPostsUpserted, metricSnapshotsInserted } =
      await upsertOwnPostsWithSnapshots(supabase, userId, scrapeRunId, batch.ownPosts)

    // 3. Inspiration posts (resolve author to person_id where possible) + engagement snapshots
    const inspirationPostsUpserted = await upsertInspirationPosts(
      supabase,
      userId,
      scrapeRunId,
      batch.inspirationPosts,
      peopleIdByKey,
    )

    // 4. Engagements
    const { engagementsUpserted, missingPost, missingPerson } = await upsertEngagements(
      supabase,
      userId,
      scrapeRunId,
      batch.engagements,
      postIdByUrn,
      peopleIdByKey,
    )

    // 5. Outcome attribution: auto-link posted drafts to the own-post they became, so the
    // engine can learn from its own track record. Best-effort — never block ingest.
    try {
      await attributePostedDrafts(userId, supabase)
    } catch (err) {
      console.error('[ingest] draft attribution skipped (non-fatal):', err)
    }

    const result: IngestResult = {
      scrapeRunId,
      counts: {
        peopleUpserted: peopleIdByKey.size,
        ownPostsUpserted,
        metricSnapshotsInserted,
        inspirationPostsUpserted,
        engagementsUpserted,
        skipped: {
          peopleMissingProfileUrl: allPeople.length - peopleIdByKey.size,
          engagementsMissingPost: missingPost,
          engagementsMissingPerson: missingPerson,
        },
      },
    }

    await supabase
      .from('scrape_runs')
      .update({
        finished_at: new Date().toISOString(),
        posts_captured: ownPostsUpserted,
        inspiration_captured: inspirationPostsUpserted,
        people_captured: peopleIdByKey.size,
        engagements_captured: engagementsUpserted,
        status: 'completed',
      })
      .eq('id', scrapeRunId)

    return result
  } catch (err) {
    await supabase
      .from('scrape_runs')
      .update({ finished_at: new Date().toISOString(), status: 'failed' })
      .eq('id', scrapeRunId)
    throw err
  }
}

// ---------- helpers ----------

// Sync the user's own LinkedIn profile data into the `profile` table.
// Only writes identity fields (display_name, headline, linkedin_url). Leaves the
// AI-inferred fields (niche, audience, tone, pillars) and user-edited fields untouched.
async function syncSelfProfile(supabase: Supa, userId: string, self: ScrapedPersonInput): Promise<void> {
  if (!self.profileUrl) return

  // Upsert ONLY the fields we want to refresh. Supabase's upsert touches exactly the columns
  // present in the payload; everything else (niche, pillars, etc.) stays as-is on update.
  const patch: Record<string, unknown> = {
    user_id: userId,
    linkedin_url: self.profileUrl,
    updated_at: new Date().toISOString(),
  }
  if (self.fullName) patch.display_name = self.fullName
  if (self.headline) patch.headline = self.headline
  if (self.bio) patch.bio = self.bio
  if (self.location) patch.location = self.location
  if (typeof self.followerCount === 'number') patch.follower_count = self.followerCount
  if (typeof self.connectionCount === 'number') patch.connection_count = self.connectionCount
  if (self.topSkills && self.topSkills.length > 0) patch.top_skills = self.topSkills
  if (self.services && self.services.length > 0) patch.services = self.services
  if (self.featured && self.featured.length > 0) patch.featured = self.featured

  const { error } = await supabase.from('profile').upsert(patch, { onConflict: 'user_id' })
  if (error) throw new Error(`profile upsert (self) failed: ${error.message}`)
}

function personKey(p: ScrapedPersonInput): string | null {
  return p.profileUrl ? p.profileUrl : null
}

function collectPeople(batch: ScrapeBatch): ScrapedPersonInput[] {
  const map = new Map<string, ScrapedPersonInput>()
  const push = (p: ScrapedPersonInput | undefined) => {
    if (!p) return
    const key = personKey(p)
    if (!key) return
    const prev = map.get(key) ?? {}
    map.set(key, { ...prev, ...p })
  }
  batch.people.forEach(push)
  batch.inspirationPosts.forEach((ip) => push(ip.author))
  batch.engagements.forEach((e) => push(e.person))
  return Array.from(map.values())
}

async function upsertPeople(
  supabase: Supa,
  userId: string,
  people: ScrapedPersonInput[],
): Promise<Map<string, string>> {
  const idByKey = new Map<string, string>()
  if (people.length === 0) return idByKey

  const now = new Date().toISOString()
  const rows = people
    .filter((p) => p.profileUrl)
    .map((p) => ({
      user_id: userId,
      linkedin_urn: p.linkedinUrn ?? null,
      profile_url: p.profileUrl!,
      full_name: p.fullName ?? null,
      headline: p.headline ?? null,
      company: p.company ?? null,
      bio: p.bio ?? null,
      location: p.location ?? null,
      follower_count: p.followerCount ?? null,
      connection_count: p.connectionCount ?? null,
      top_skills: p.topSkills ?? null,
      services: p.services ?? null,
      featured: p.featured ?? [], // NOT NULL column — default to empty array, never null
      is_connection: p.isConnection ?? false,
      last_seen_at: now,
      raw: p.raw ?? null,
    }))

  if (rows.length === 0) return idByKey

  const { data, error } = await supabase
    .from('people')
    .upsert(rows, { onConflict: 'user_id,profile_url' })
    .select('id, profile_url')

  if (error) throw new Error(`people upsert failed: ${error.message}`)

  for (const row of data ?? []) {
    if (row.profile_url) idByKey.set(row.profile_url, row.id)
  }
  return idByKey
}

async function upsertOwnPostsWithSnapshots(
  supabase: Supa,
  userId: string,
  scrapeRunId: string,
  posts: ScrapedOwnPostInput[],
): Promise<{ postIdByUrn: Map<string, string>; ownPostsUpserted: number; metricSnapshotsInserted: number }> {
  const postIdByUrn = new Map<string, string>()
  if (posts.length === 0) return { postIdByUrn, ownPostsUpserted: 0, metricSnapshotsInserted: 0 }

  const rows = posts.map((p) => ({
    user_id: userId,
    linkedin_urn: p.linkedinUrn,
    url: p.url ?? null,
    posted_at: p.postedAt ?? null,
    body: p.body ?? null,
    media: p.media ?? null,
    raw: p.raw ?? null,
  }))

  const { data, error } = await supabase
    .from('scraped_posts')
    .upsert(rows, { onConflict: 'user_id,linkedin_urn' })
    .select('id, linkedin_urn')

  if (error) throw new Error(`scraped_posts upsert failed: ${error.message}`)

  for (const row of data ?? []) {
    postIdByUrn.set(row.linkedin_urn, row.id)
  }

  // Snapshot metrics for posts that came with metrics.
  const snapshotRows = posts
    .filter((p) => p.metrics && hasAnyMetric(p.metrics))
    .map((p) => ({
      post_id: postIdByUrn.get(p.linkedinUrn)!,
      scrape_run_id: scrapeRunId,
      impressions: safeInt(p.metrics?.impressions),
      likes: safeInt(p.metrics?.likes),
      comments: safeInt(p.metrics?.comments),
      reposts: safeInt(p.metrics?.reposts),
    }))

  if (snapshotRows.length > 0) {
    const { error: snapErr } = await supabase.from('post_metric_snapshots').insert(snapshotRows)
    if (snapErr) throw new Error(`metric snapshots insert failed: ${snapErr.message}`)
  }

  return {
    postIdByUrn,
    ownPostsUpserted: data?.length ?? 0,
    metricSnapshotsInserted: snapshotRows.length,
  }
}

function hasAnyMetric(m: ScrapedOwnPostInput['metrics']): boolean {
  if (!m) return false
  return [m.impressions, m.likes, m.comments, m.reposts].some((v) => v != null)
}

async function upsertInspirationPosts(
  supabase: Supa,
  userId: string,
  scrapeRunId: string,
  posts: ScrapedInspirationPostInput[],
  peopleIdByKey: Map<string, string>,
): Promise<number> {
  const deduped = posts.filter((p) => p.linkedinUrn)
  const rows = deduped.map((p) => ({
    user_id: userId,
    linkedin_urn: p.linkedinUrn!,
    url: p.url ?? null,
    author_person_id: p.author?.profileUrl ? peopleIdByKey.get(p.author.profileUrl) ?? null : null,
    body: p.body ?? null,
    media: p.media ?? null,
    posted_at: p.postedAt ?? null,
    likes: safeInt(p.likes),
    comments: safeInt(p.comments),
    reposts: safeInt(p.reposts),
    raw: p.raw ?? null,
  }))

  if (rows.length === 0) return 0

  const { data, error } = await supabase
    .from('inspiration_posts')
    .upsert(rows, { onConflict: 'user_id,linkedin_urn' })
    .select('id, linkedin_urn')

  if (error) throw new Error(`inspiration_posts upsert failed: ${error.message}`)

  // Engagement history: record one snapshot per captured post that has any count, so we can
  // track velocity over time (inspiration_posts itself only keeps the latest values).
  // Best-effort: never let a snapshot failure (e.g. migration not yet applied) break ingest.
  try {
    const idByUrn = new Map<string, string>()
    for (const r of (data ?? []) as { id: string; linkedin_urn: string }[]) idByUrn.set(r.linkedin_urn, r.id)
    const snapshotRows = deduped
      .filter((p) => p.likes != null || p.comments != null || p.reposts != null)
      .map((p) => ({
        user_id: userId,
        inspiration_post_id: idByUrn.get(p.linkedinUrn!),
        scrape_run_id: scrapeRunId,
        likes: safeInt(p.likes),
        comments: safeInt(p.comments),
        reposts: safeInt(p.reposts),
      }))
      .filter((r) => r.inspiration_post_id)
    if (snapshotRows.length > 0) {
      const { error: snapErr } = await supabase.from('inspiration_metric_snapshots').insert(snapshotRows)
      if (snapErr) console.error('[ingest] inspiration snapshot insert skipped:', snapErr.message)
    }
  } catch (err) {
    console.error('[ingest] inspiration snapshot insert threw (non-fatal):', err)
  }

  return data?.length ?? 0
}

async function upsertEngagements(
  supabase: Supa,
  userId: string,
  scrapeRunId: string,
  engagements: ScrapedEngagementInput[],
  postIdByUrn: Map<string, string>,
  peopleIdByKey: Map<string, string>,
): Promise<{ engagementsUpserted: number; missingPost: number; missingPerson: number }> {
  let missingPost = 0
  let missingPerson = 0
  const rows: Array<Record<string, unknown>> = []

  for (const e of engagements) {
    const postId = postIdByUrn.get(e.postUrn)
    if (!postId) {
      missingPost++
      continue
    }
    const personKeyVal = e.person.profileUrl
    const personId = personKeyVal ? peopleIdByKey.get(personKeyVal) : undefined
    if (!personId) {
      missingPerson++
      continue
    }
    rows.push({
      user_id: userId,
      post_id: postId,
      person_id: personId,
      type: e.type,
      reaction: e.reaction ?? null,
      comment_text: e.commentText ?? null,
      engaged_at: e.engagedAt ?? null,
      scrape_run_id: scrapeRunId,
    })
  }

  if (rows.length === 0) return { engagementsUpserted: 0, missingPost, missingPerson }

  const { data, error } = await supabase
    .from('engagements')
    .upsert(rows, { onConflict: 'post_id,person_id,type' })
    .select('id')

  if (error) throw new Error(`engagements upsert failed: ${error.message}`)
  return { engagementsUpserted: data?.length ?? 0, missingPost, missingPerson }
}
