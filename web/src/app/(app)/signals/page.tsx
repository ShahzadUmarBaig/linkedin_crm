import { requireUser } from '@/lib/auth'
import { getSignals } from '@/lib/signals'
import { SignalsView } from './signals-view'

// The "Extract topics" server action (invoked from this route) batches through the backlog,
// which can take longer than the default function window.
export const maxDuration = 60

export default async function SignalsPage() {
  const user = await requireUser()
  const data = await getSignals(user.id)
  return <SignalsView data={data} />
}
