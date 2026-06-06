import { requireUser } from '@/lib/auth'
import { getSignals } from '@/lib/signals'
import { SignalsView } from './signals-view'

export default async function SignalsPage() {
  const user = await requireUser()
  const data = await getSignals(user.id)
  return <SignalsView data={data} />
}
