// Strongly-typed wrapper around chrome.storage.local for the extension's config.

export interface ExtensionConfig {
  apiBaseUrl: string      // e.g. https://your-crm.vercel.app
  ingestSecret: string    // matches EXTENSION_INGEST_SECRET in the web app's env
  userId: string          // the Supabase auth user_id this scrape belongs to
  selfLinkedinSlug: string // your LinkedIn slug (the bit after /in/), used to tell own posts from others'
}

const KEYS: (keyof ExtensionConfig)[] = ['apiBaseUrl', 'ingestSecret', 'userId', 'selfLinkedinSlug']

export async function getConfig(): Promise<Partial<ExtensionConfig>> {
  return (await chrome.storage.local.get(KEYS)) as Partial<ExtensionConfig>
}

export async function setConfig(patch: Partial<ExtensionConfig>): Promise<void> {
  await chrome.storage.local.set(patch)
}

export function hasFullConfig(c: Partial<ExtensionConfig>): c is ExtensionConfig {
  // selfLinkedinSlug is optional — without it, posts captured on activity pages
  // are all treated as inspiration (we can't tell which are yours).
  return Boolean(c.apiBaseUrl && c.ingestSecret && c.userId)
}
