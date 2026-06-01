// Auth helpers used by server components and route handlers.
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from './supabase/server'

export async function getUser() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user
}

export async function requireUser() {
  const user = await getUser()
  if (!user) redirect('/login')
  return user
}
