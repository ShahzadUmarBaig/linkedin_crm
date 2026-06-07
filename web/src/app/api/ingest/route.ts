import { NextResponse, after, type NextRequest } from 'next/server'
import { ingestBatch } from '@/lib/ingest'
import { generateIdeas } from '@/lib/ideas'
import { extractTopicsForUser } from '@/lib/topics'
import type { ScrapeBatch } from '@crm/shared'

// Extension → CRM ingest endpoint.
// Auth model (V1, single-user): shared secret in Authorization header + user_id in X-User-Id.
// The endpoint runs with the service role and bypasses RLS because the secret is the source
// of trust. Swap to a real Supabase bearer token when going multi-user.
//
// CORS: open to any origin because authentication is by shared bearer secret, not cookies.
// We deliberately do NOT set Allow-Credentials.

export const runtime = 'nodejs'
// Allow up to 60s — covers the ingest writes (fast) + the after() idea-generation pass (5-15s).
export const maxDuration = 60

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-user-id, content-type',
  'Access-Control-Max-Age': '86400',
}

function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v)
  return res
}

export function OPTIONS() {
  // Preflight. 204 with the CORS headers is the standard response.
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization')
  const expected = process.env.EXTENSION_INGEST_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }))
  }

  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return withCors(NextResponse.json({ error: 'missing x-user-id' }, { status: 400 }))
  }

  let batch: ScrapeBatch
  try {
    batch = (await request.json()) as ScrapeBatch
  } catch {
    return withCors(NextResponse.json({ error: 'invalid json' }, { status: 400 }))
  }

  try {
    const result = await ingestBatch(userId, batch)

    // Trigger idea generation in the background — the user doesn't wait on it,
    // and failures here don't affect the ingest response.
    after(async () => {
      // Tag newly-ingested posts with topics first so trends + idea generation see fresh signal.
      try {
        const t = await extractTopicsForUser(userId, { scrapeRunId: result.scrapeRunId })
        if (!t.skipped) console.log(`[topics] tagged ${t.processed} posts (cost $${(t.costUsd ?? 0).toFixed(4)}, model ${t.model})`)
      } catch (err) {
        console.error('[topics] extraction failed', err)
      }
      try {
        const r = await generateIdeas(userId, { scrapeRunId: result.scrapeRunId })
        if (r.skipped) {
          console.log(`[ideas] skipped: ${r.reason}`)
        } else {
          console.log(`[ideas] generated ${r.generated} (cost $${(r.costUsd ?? 0).toFixed(4)}, model ${r.model})`)
        }
      } catch (err) {
        console.error('[ideas] generation failed', err)
      }
    })

    return withCors(NextResponse.json(result))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ingest failed'
    return withCors(NextResponse.json({ error: message }, { status: 500 }))
  }
}
