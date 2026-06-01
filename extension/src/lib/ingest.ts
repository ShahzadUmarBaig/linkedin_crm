import type { ScrapeBatch } from '@crm/shared'
import { getConfig, hasFullConfig } from './storage'

export async function sendBatch(batch: ScrapeBatch): Promise<{ scrapeRunId: string }> {
  const config = await getConfig()
  if (!hasFullConfig(config)) {
    throw new Error('Extension is not configured. Open the popup and set API URL, secret, and user ID.')
  }

  const res = await fetch(`${config.apiBaseUrl}/api/ingest`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.ingestSecret}`,
      'x-user-id': config.userId,
    },
    body: JSON.stringify(batch),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`ingest failed (${res.status}): ${text}`)
  }

  return res.json()
}
