import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { loadSettings } from '@/lib/settings'
import { SettingsForm } from './settings-form'

export default async function SettingsPage() {
  const user = await requireUser()
  const settings = await loadSettings(user.id)

  return (
    <main className="min-h-screen bg-zinc-50 p-8 dark:bg-zinc-950">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Link href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
              ← Dashboard
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
          </div>
        </div>

        <SettingsForm initial={settings} />
      </div>
    </main>
  )
}
