import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { loadProfile } from '@/lib/profile'
import { ProfileEditor } from './profile-editor'

export default async function ProfilePage() {
  const user = await requireUser()
  const profile = await loadProfile(user.id)

  return (
    <main className="min-h-screen bg-zinc-50 p-8 dark:bg-zinc-950">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <Link href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Your niche, pillars, tone, and audience. Used to generate post ideas that sound like you.
          </p>
        </div>

        <ProfileEditor initial={profile} />
      </div>
    </main>
  )
}
