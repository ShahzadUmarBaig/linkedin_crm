// MV3 service worker. Routes messages between content script and popup,
// and handles the actual upload to the backend.

import { snapshotBatch, clearBuffer, bufferStats } from './lib/buffer'
import { sendBatch } from './lib/ingest'

type Msg =
  | { type: 'flush' }
  | { type: 'stats' }
  | { type: 'clear' }
  | { type: 'capture-dom' }

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  ;(async () => {
    try {
      if (msg.type === 'flush') {
        const batch = await snapshotBatch()
        const result = await sendBatch(batch)
        await clearBuffer()
        sendResponse({ ok: true, result })
      } else if (msg.type === 'stats') {
        sendResponse({ ok: true, stats: await bufferStats() })
      } else if (msg.type === 'clear') {
        await clearBuffer()
        sendResponse({ ok: true })
      } else if (msg.type === 'capture-dom') {
        // Relay to the active tab's content script.
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id) {
          sendResponse({ ok: false, error: 'No active tab.' })
          return
        }
        try {
          const result = await chrome.tabs.sendMessage(tab.id, { type: 'capture-dom-request' })
          sendResponse(result)
        } catch (err) {
          sendResponse({
            ok: false,
            error: `Content script not reachable: ${(err as Error).message}. Refresh the LinkedIn tab and try again.`,
          })
        }
      } else {
        sendResponse({ ok: false, error: 'unknown message' })
      }
    } catch (err) {
      sendResponse({ ok: false, error: (err as Error).message })
    }
  })()
  return true // async sendResponse
})
