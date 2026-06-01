import { getUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { LoginForm } from './login-form'

export default async function LoginPage() {
  const user = await getUser()
  if (user) redirect('/dashboard')

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-1 text-xl font-semibold tracking-tight">LinkedIn CRM</h1>
        <p className="mb-6 text-sm text-zinc-500">Sign in to continue.</p>
        <LoginForm />
      </div>
    </main>
  )
}
