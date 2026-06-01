import { NextResponse, type NextRequest } from 'next/server'
import { ingestBatch } from '@/lib/ingest'
import type { ScrapeBatch } from '@crm/shared'

// Extension → CRM ingest endpoint.
// Auth model (V1, single-user): shared secret in Authorization header + user_id in X-User-Id.
// The endpoint runs with the service role and bypasses RLS because the secret is the source
// of trust. Swap to a real Supabase bearer token when going multi-user.
//
// CORS: open to any origin because authentication is by shared bearer secret, not cookies.
// We deliberately do NOT set Allow-Credentials.

export const runtime = 'nodejs'

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
    return withCors(NextResponse.json(result))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ingest failed'
    return withCors(NextResponse.json({ error: message }, { status: 500 }))
  }
}
