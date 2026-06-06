import { requireUser } from '@/lib/auth'
import { loadProfile } from '@/lib/profile'
import { ProfileEditor } from './profile-editor'

export default async function ProfilePage() {
  const user = await requireUser()
  const profile = await loadProfile(user.id)

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="box pad-lg mb16">
        <div className="h-page">Profile</div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 0' }}>
          Your niche, pillars, tone, and audience. Used to generate post ideas that sound like you.
        </p>
      </div>
      <ProfileEditor initial={profile} />
    </div>
  )
}
