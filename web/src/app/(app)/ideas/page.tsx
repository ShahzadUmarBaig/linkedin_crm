import { requireUser } from '@/lib/auth'
import { listIdeas } from '@/lib/ideas'
import { getTrends } from '@/lib/dashboard'
import { IdeasView } from './ideas-list'

export default async function IdeasPage() {
  const user = await requireUser()
  const [proposed, rejected, trends] = await Promise.all([
    listIdeas(user.id, 'proposed'),
    listIdeas(user.id, 'rejected'),
    getTrends(user.id, 5),
  ])

  return <IdeasView proposed={proposed} rejected={rejected} trends={trends} />
}
