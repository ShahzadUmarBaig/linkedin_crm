import { requireUser } from '@/lib/auth'
import { getRssData } from '@/lib/rss'
import { RssView } from './rss-view'

export default async function RssPage() {
  const user = await requireUser()
  const data = await getRssData(user.id)
  return <RssView data={data} />
}
