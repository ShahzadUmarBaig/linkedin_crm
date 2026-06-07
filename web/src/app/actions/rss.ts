'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { addFeed, refreshAllFeedsForUser, removeFeed } from '@/lib/rss'

export async function addFeedAction(url: string): Promise<{ error: string } | { ok: true; title: string | null; itemsAdded: number }> {
  const user = await requireUser()
  try {
    const { feed, itemsAdded } = await addFeed(user.id, url)
    revalidatePath('/rss')
    return { ok: true, title: feed.title, itemsAdded }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'could not add feed' }
  }
}

export async function removeFeedAction(feedId: string): Promise<{ error?: string; ok?: true }> {
  const user = await requireUser()
  try {
    await removeFeed(user.id, feedId)
    revalidatePath('/rss')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'could not remove feed' }
  }
}

export async function refreshFeedsAction(): Promise<{ error: string } | { ok: true; feedsFetched: number; itemsAdded: number }> {
  const user = await requireUser()
  try {
    const r = await refreshAllFeedsForUser(user.id)
    revalidatePath('/rss')
    return { ok: true, ...r }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'refresh failed' }
  }
}
