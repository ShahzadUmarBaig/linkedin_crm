import { headers } from 'next/headers'
import { requireUser } from '@/lib/auth'
import { loadSettings } from '@/lib/settings'
import { SettingsForm } from './settings-form'
import { CopyField } from './copy-field'

async function getBaseUrl(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export default async function SettingsPage() {
  const user = await requireUser()
  const [settings, baseUrl] = await Promise.all([loadSettings(user.id), getBaseUrl()])

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="box pad-lg mb16">
        <div className="h-page">Settings</div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 0' }}>
          Bring your own API keys, choose models, and cap monthly AI spend.
        </p>
      </div>

      <div className="box pad-lg mb16">
        <span className="eyebrow">Extension setup</span>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 14px' }}>
          Paste these two values into the LinkedIn CRM Chrome extension&apos;s settings so it can send
          your scraped activity here.
        </p>
        <div className="stack gap12">
          <CopyField label="API base URL" value={baseUrl} hint="Where the extension POSTs scraped data." />
          <CopyField label="User ID" value={user.id} hint="Identifies your account on ingest." />
        </div>
      </div>

      <SettingsForm initial={settings} />
    </div>
  )
}
