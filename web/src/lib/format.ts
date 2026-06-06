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

// Heuristic "predicted reach" preview until the real scoring engine ships with Autopilot.
export function reachLabel(sourceType: string | null): { label: string; tone: 'good' | 'auto' } {
  switch (sourceType) {
    case 'inspiration_post':
      return { label: 'High', tone: 'good' }
    case 'own_post_pattern':
      return { label: 'Medium', tone: 'auto' }
    default:
      return { label: 'Medium', tone: 'auto' }
  }
}

export function sourceLabel(src: string | null): string {
  switch (src) {
    case 'inspiration_post':
      return 'trend-led'
    case 'own_post_pattern':
      return 'your pattern'
    case 'niche_research':
      return 'niche research'
    default:
      return src ?? 'idea'
  }
}
