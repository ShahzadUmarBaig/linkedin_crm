import { requireUser } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadSettings } from '@/lib/settings'
import { AppShell, type ShellNavCounts } from './app-shell'

async function loadNavCounts(userId: string): Promise<ShellNavCounts> {
  const supabase = await createSupabaseServerClient()
  const [{ count: ideas }, { count: calendar }] = await Promise.all([
    supabase
      .from('ideas')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'proposed'),
    supabase
      .from('calendar_slots')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'scheduled')
      .lte('scheduled_for', new Date().toISOString()),
  ])
  return { ideas: ideas ?? 0, calendar: calendar ?? 0 }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const [counts, settings] = await Promise.all([loadNavCounts(user.id), loadSettings(user.id)])
  return (
    <AppShell
      email={user.email ?? 'you'}
      counts={counts}
      autopilotEnabled={settings.autopilotEnabled}
      lastAutopilotRunAt={settings.lastAutopilotRunAt}
    >
      {children}
    </AppShell>
  )
}
