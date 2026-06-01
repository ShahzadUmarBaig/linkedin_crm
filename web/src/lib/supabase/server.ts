// Server-side Supabase client (RSC, Route Handlers, Server Actions).
// In Next 16 `cookies()` is async — must be awaited.
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component — middleware refreshes the session instead.
          }
        },
      },
    },
  )
}

// Service-role client. Bypasses RLS. Use ONLY in server-only code that has
// already authenticated the caller out-of-band (e.g. extension ingest endpoint).
import { createClient } from '@supabase/supabase-js'

export function createSupabaseServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
