import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { listSlots } from '@/lib/calendar'
import { CalendarList } from './calendar-list'

export default async function CalendarPage() {
  const user = await requireUser()
  const [upcoming, posted, skipped] = await Promise.all([
    listSlots(user.id, { status: 'scheduled' }),
    listSlots(user.id, { status: 'posted' }),
    listSlots(user.id, { status: 'skipped' }),
  ])

  return (
    <main className="min-h-screen bg-zinc-50 p-8 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <Link href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Drafts you approved. AI picked the slot from your past engagement data — you can reschedule
            or edit any time. When you publish on LinkedIn, click "Mark as posted" so we can correlate
            performance on the next scrape.
          </p>
        </div>

        <CalendarList upcoming={upcoming} posted={posted} skipped={skipped} />
      </div>
    </main>
  )
}
