// Content script entry point.
// Passively observes the DOM. We never auto-scroll or auto-navigate.

import { recordPage, recordPerson } from '../lib/buffer'
import { extractProfile } from './extractors/profile'
import { onUrlChange } from './observer'
import { isProfilePage, waitFor } from './util'

async function runExtractors() {
  await recordPage(location.href)

  if (isProfilePage()) {
    // Wait until the page has rendered enough to find a name. LinkedIn streams content in;
    // running too early returns nulls.
    const person = await waitFor(() => extractProfile(), { timeoutMs: 8000 })
    if (person) {
      await recordPerson(person)
      // Remember the last captured profile so the popup can show visual feedback.
      await chrome.storage.local.set({
        lastCapture: { kind: 'profile', name: person.fullName, at: new Date().toISOString() },
      })
      console.log('[linkedin-crm] captured profile', person.fullName)
    }
  }
}

void runExtractors()
onUrlChange(() => {
  void runExtractors()
})
