// Small presentation helpers shared across screens.

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatDayTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

export function truncate(s: string, n: number): string {
  const trimmed = s.trim()
  return trimmed.length <= n ? trimmed : trimmed.slice(0, n - 1).trimEnd() + '…'
}

export function compactNumber(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k'
  return String(n)
}

export function sourceLabel(src: string | null): string {
  switch (src) {
    case 'own_post_pattern':
      return 'your posts'
    case 'inspiration_post':
      return 'your feed'
    case 'rss_item':
      return 'newsletter'
    case 'niche_research':
      return 'research'
    default:
      return src ?? 'idea'
  }
}

// 1-100 score → a qualitative tone for the badge.
export function scoreTone(score: number | null): 'good' | 'auto' | '' {
  if (score == null) return ''
  if (score >= 75) return 'good'
  if (score >= 55) return 'auto'
  return ''
}
