import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { logout } from '@/app/actions/auth'
import { UserIdCopy } from './user-id-copy'

export default async function DashboardPage() {
  const user = await requireUser()

  return (
    <main className="min-h-screen bg-zinc-50 p-8 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-zinc-500">{user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/profile"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Profile
            </Link>
            <Link
              href="/settings"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Settings
            </Link>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Extension setup
          </h2>
          <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
            Open the LinkedIn CRM Chrome extension popup and paste these values into Settings.
          </p>

          <div className="space-y-3">
            <UserIdCopy userId={user.id} />
            <Field
              label="API base URL"
              value=""
              fallback="Your deployed CRM URL (e.g. http://localhost:3000 in dev)"
            />
            <Field
              label="Ingest secret"
              value=""
              fallback="The value of EXTENSION_INGEST_SECRET from web/.env.local"
              monospace
            />
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
          Once your extension is configured and you&apos;ve scraped some LinkedIn activity, this
          dashboard will show your latest posts, idea queue, and scheduled calendar slots.
        </section>
      </div>
    </main>
  )
}

function Field({ label, value, fallback, monospace }: { label: string; value: string; fallback?: string; monospace?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-zinc-500">{label}</div>
      <div
        className={`rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950 ${
          monospace ? 'font-mono' : ''
        }`}
      >
        {value || <span className="text-zinc-400">{fallback}</span>}
      </div>
    </div>
  )
}
