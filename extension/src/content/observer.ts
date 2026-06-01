// LinkedIn is a SPA: navigations change `location.href` without a page reload.
// We listen for URL changes and re-run the extractor pipeline against the new URL.
// Strategy: patch history.pushState/replaceState + listen to popstate.

type Handler = (href: string) => void | Promise<void>

let installed = false
const handlers: Handler[] = []
let lastHref = location.href

export function onUrlChange(handler: Handler) {
  handlers.push(handler)
  if (!installed) install()
}

function install() {
  installed = true

  const fire = () => {
    const href = location.href
    if (href === lastHref) return
    lastHref = href
    handlers.forEach((h) => {
      try {
        void h(href)
      } catch (err) {
        console.error('[linkedin-crm] url-change handler failed', err)
      }
    })
  }

  const wrap = (fnName: 'pushState' | 'replaceState') => {
    const original = history[fnName].bind(history) as History[typeof fnName]
    history[fnName] = function (data: unknown, unused: string, url?: string | URL | null) {
      const result = original(data, unused, url)
      queueMicrotask(fire)
      return result
    }
  }
  wrap('pushState')
  wrap('replaceState')
  window.addEventListener('popstate', fire)

  // Belt-and-suspenders: poll every 1.5s for any history changes the patches missed.
  setInterval(fire, 1500)
}
