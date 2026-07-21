import { requireUser } from '@/lib/auth'
import { ComposeNewForm } from './compose-new-form'

// The AI call inside composeDraftFromSeed can take a while (draft + slot + optional image
// prompt guard). Match the /compose maxDuration.
export const maxDuration = 60

export default async function ComposeNewPage() {
  await requireUser()
  return <ComposeNewForm />
}
