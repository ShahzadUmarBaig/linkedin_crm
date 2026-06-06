import { requireUser } from '@/lib/auth'
import { loadSettings } from '@/lib/settings'
import { SettingsForm } from './settings-form'

export default async function SettingsPage() {
  const user = await requireUser()
  const settings = await loadSettings(user.id)

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="box pad-lg mb16">
        <div className="h-page">Settings</div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 0' }}>
          Bring your own API keys, choose models, and cap monthly AI spend.
        </p>
      </div>
      <SettingsForm initial={settings} />
    </div>
  )
}
