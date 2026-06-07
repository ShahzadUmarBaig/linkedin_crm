// Strongly-typed wrapper around chrome.storage.local for the extension's config.

export interface ExtensionConfig {
  apiBaseUrl: string      // e.g. https://your-crm.vercel.app
  ingestSecret: string    // matches EXTENSION_INGEST_SECRET in the web app's env
  userId: string          // the Supabase auth user_id this scrape belongs to
  selfLinkedinSlug: string // your LinkedIn slug (the bit after /in/), used to tell own posts from others'
}

const KEYS: (keyof ExtensionConfig)[] = ['apiBaseUrl', 'ingestSecret', 'userId', 'selfLinkedinSlug']

// True only while this content script's extension context is still valid. After the extension
// is reloaded/updated, lingering content scripts on open tabs lose their context and any
// chrome.* call throws "Extension context invalidated." Guard every chrome.* call with this.
export function isExtensionAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id)
  } catch {
    return false
  }
}

export async function getConfig(): Promise<Partial<ExtensionConfig>> {
  if (!isExtensionAlive()) return {}
  try {
    return (await chrome.storage.local.get(KEYS)) as Partial<ExtensionConfig>
  } catch {
    return {}
  }
}

export async function setConfig(patch: Partial<ExtensionConfig>): Promise<void> {
  await chrome.storage.local.set(patch)
}

export function hasFullConfig(c: Partial<ExtensionConfig>): c is ExtensionConfig {
  // selfLinkedinSlug is optional — without it, posts captured on activity pages
  // are all treated as inspiration (we can't tell which are yours).
  return Boolean(c.apiBaseUrl && c.ingestSecret && c.userId)
}
