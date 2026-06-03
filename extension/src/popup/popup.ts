import { getConfig, setConfig } from '../lib/storage'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const statsEl = $<HTMLDivElement>('stats')
const statusEl = $<HTMLDivElement>('status')
const apiBaseUrlInput = $<HTMLInputElement>('apiBaseUrl')
const ingestSecretInput = $<HTMLInputElement>('ingestSecret')
const userIdInput = $<HTMLInputElement>('userId')
const selfSlugInput = $<HTMLInputElement>('selfLinkedinSlug')

function setStatus(message: string, kind: 'ok' | 'err' | null) {
  statusEl.textContent = message
  statusEl.className = kind ? `status ${kind}` : ''
}

async function refreshStats() {
  const res = await chrome.runtime.sendMessage({ type: 'stats' })
  if (res?.ok) {
    const s = res.stats
    statsEl.innerHTML = `
      <div><span>Own posts</span><span>${s.ownPosts}</span></div>
      <div><span>Inspiration</span><span>${s.inspirationPosts}</span></div>
      <div><span>People</span><span>${s.people}</span></div>
      <div><span>Engagements</span><span>${s.engagements}</span></div>
      <div><span>Pages observed</span><span>${s.pages}</span></div>
    `
  } else {
    statsEl.textContent = 'Could not load stats.'
  }

  const lastCaptureEl = document.getElementById('lastCapture')
  if (lastCaptureEl) {
    const { lastCapture } = await chrome.storage.local.get('lastCapture')
    if (lastCapture?.name) {
      const ago = timeAgo(new Date(lastCapture.at))
      lastCaptureEl.textContent = `Last captured: ${lastCapture.name} (${ago})`
    } else {
      lastCaptureEl.textContent = 'No captures yet — open a LinkedIn profile.'
    }
  }
}

function timeAgo(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

async function loadConfig() {
  const c = await getConfig()
  apiBaseUrlInput.value = c.apiBaseUrl ?? ''
  ingestSecretInput.value = c.ingestSecret ?? ''
  userIdInput.value = c.userId ?? ''
  selfSlugInput.value = c.selfLinkedinSlug ?? ''
}

$<HTMLButtonElement>('save').addEventListener('click', async () => {
  await setConfig({
    apiBaseUrl: apiBaseUrlInput.value.trim().replace(/\/$/, ''),
    ingestSecret: ingestSecretInput.value.trim(),
    userId: userIdInput.value.trim(),
    selfLinkedinSlug: selfSlugInput.value.trim().replace(/^\/+|\/+$/g, '').replace(/^in\//, ''),
  })
  setStatus('Settings saved.', 'ok')
})

$<HTMLButtonElement>('scrape').addEventListener('click', async () => {
  setStatus('Uploading…', null)
  const res = await chrome.runtime.sendMessage({ type: 'flush' })
  if (res?.ok) {
    setStatus(`Uploaded. scrapeRunId=${res.result.scrapeRunId}`, 'ok')
    refreshStats()
  } else {
    setStatus(res?.error ?? 'Failed.', 'err')
  }
})

$<HTMLButtonElement>('clear').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clear' })
  setStatus('Buffer cleared.', 'ok')
  refreshStats()
})

$<HTMLButtonElement>('copyDom').addEventListener('click', async () => {
  setStatus('Capturing DOM…', null)
  const res = await chrome.runtime.sendMessage({ type: 'capture-dom' })
  if (!res?.ok) {
    setStatus(res?.error ?? 'Capture failed.', 'err')
    return
  }
  try {
    await navigator.clipboard.writeText(res.dom)
    const kb = Math.round(res.dom.length / 1024)
    setStatus(`Copied ${kb} KB to clipboard from ${shortHost(res.url)}.`, 'ok')
  } catch (err) {
    setStatus(`Captured but clipboard write failed: ${(err as Error).message}`, 'err')
  }
})

function shortHost(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname.length > 30 ? u.pathname.slice(0, 30) + '…' : u.pathname
  } catch {
    return url
  }
}

loadConfig()
refreshStats()
