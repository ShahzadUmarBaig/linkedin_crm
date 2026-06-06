import { requireUser } from '@/lib/auth'
import { listSlots } from '@/lib/calendar'
import { CalendarView } from './calendar-view'

export default async function CalendarPage() {
  const user = await requireUser()
  const [upcoming, posted, skipped] = await Promise.all([
    listSlots(user.id, { status: 'scheduled' }),
    listSlots(user.id, { status: 'posted' }),
    listSlots(user.id, { status: 'skipped' }),
  ])

  return <CalendarView upcoming={upcoming} posted={posted} skipped={skipped} />
}
