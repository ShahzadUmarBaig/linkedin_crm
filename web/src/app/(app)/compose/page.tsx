import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { getComposeView } from '@/lib/compose'
import { ComposeView } from './compose-view'

// "Regenerate draft" (invoked from this route) makes an AI call that can exceed the default window.
export const maxDuration = 60

export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<{ slot?: string; draft?: string }>
}) {
  const user = await requireUser()
  const sp = await searchParams
  const view = await getComposeView(user.id, { slotId: sp.slot, draftId: sp.draft })

  if (!view) {
    return (
      <div className="box pad-lg" style={{ textAlign: 'center' }}>
        <div className="h-sec">Nothing to compose yet</div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '8px 0 16px' }}>
          Approve an idea and AI will draft a post here for you to review.
        </p>
        <Link className="btn primary" href="/ideas">Go to Ideas →</Link>
      </div>
    )
  }

  return <ComposeView view={view} />
}
