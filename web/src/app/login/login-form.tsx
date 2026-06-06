'use client'

import { useActionState, useState } from 'react'
import { login, signup } from '@/app/actions/auth'

type Mode = 'login' | 'signup'

export function LoginForm() {
  const [mode, setMode] = useState<Mode>('login')
  const action = mode === 'login' ? login : signup
  const [state, formAction, pending] = useActionState(
    async (_prev: { error: string } | null, formData: FormData) => {
      const result = await action(formData)
      return result ?? null
    },
    null,
  )

  return (
    <form action={formAction} className="stack gap12">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="field" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          className="field"
        />
      </div>

      {state?.error && <p className="banner err">{state.error}</p>}

      <button type="submit" disabled={pending} className="btn primary" style={{ width: '100%' }}>
        {pending ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>

      <button
        type="button"
        onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
        className="vtab"
        style={{ width: '100%', textAlign: 'center' }}
      >
        {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
      </button>
    </form>
  )
}
