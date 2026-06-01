import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { listIdeas } from '@/lib/ideas'
import { IdeasList } from './ideas-list'

export default async function IdeasPage() {
  const user = await requireUser()
  const [proposed, rejected] = await Promise.all([
    listIdeas(user.id, 'proposed'),
    listIdeas(user.id, 'rejected'),
  ])

  return (
    <main className="min-h-screen bg-zinc-50 p-8 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <Link href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Ideas</h1>
          <p className="mt-1 text-sm text-zinc-500">
            AI proposes ideas from your profile + recent scrapes. Approve one to expand into a draft.
            Queue auto-fills to 5 after each scrape.
          </p>
        </div>

        <IdeasList proposed={proposed} rejected={rejected} />
      </div>
    </main>
  )
}
