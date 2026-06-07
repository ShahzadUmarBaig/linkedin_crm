import { NextResponse, type NextRequest } from 'next/server'
import { runAutopilotAll } from '@/lib/autopilot'

// Nightly autopilot. Triggered by Vercel Cron (see web/vercel.json), which sends
// `Authorization: Bearer ${CRON_SECRET}` automatically when CRON_SECRET is set in the
// project env. We reject anything without the matching secret.

export const runtime = 'nodejs'
export const maxDuration = 300 // pipeline does AI calls per user

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const results = await runAutopilotAll()
    const ideas = results.reduce((a, r) => a + r.ideasGenerated, 0)
    const topics = results.reduce((a, r) => a + r.topicsProcessed, 0)
    console.log(`[autopilot] ran for ${results.length} user(s): ${ideas} ideas, ${topics} posts tagged`)
    return NextResponse.json({ ranFor: results.length, ideas, topics, results })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'autopilot failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
