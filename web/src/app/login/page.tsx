import { getUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { LoginForm } from './login-form'

export default async function LoginPage() {
  const user = await getUser()
  if (user) redirect('/dashboard')

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="box pad-lg" style={{ width: '100%', maxWidth: 360 }}>
        <div className="row gap10 center" style={{ marginBottom: 16 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent)' }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>LinkedIn CRM</div>
            <span className="eyebrow" style={{ fontSize: 9 }}>content engine</span>
          </div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 18px' }}>Sign in to continue.</p>
        <LoginForm />
      </div>
    </main>
  )
}
