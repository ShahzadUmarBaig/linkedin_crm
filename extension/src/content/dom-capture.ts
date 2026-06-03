// Sanitized DOM snapshot for debugging selectors.
// Captures the structure of <main> (or body), preserving tag names, classes, ids, data-*
// and aria-* attributes, href/src — exactly the things we use to write selectors. Strips
// scripts, styles, inline event handlers, SVG internals, and very long values that bloat
// size without informing selector choices.

interface CaptureOpts {
  root?: Element
  maxDepth?: number
  maxNodes?: number
  maxTextLen?: number
  maxAttrLen?: number
}

export function captureDom(opts: CaptureOpts = {}): string {
  const root = opts.root ?? document.querySelector('main') ?? document.body
  const maxDepth = opts.maxDepth ?? 50
  const maxNodes = opts.maxNodes ?? 8000
  const maxTextLen = opts.maxTextLen ?? 600
  const maxAttrLen = opts.maxAttrLen ?? 200

  let nodesEmitted = 0

  function emit(node: Node, depth: number): string {
    if (nodesEmitted >= maxNodes) return ''
    if (depth > maxDepth) return ''

    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? '').trim()
      if (!t) return ''
      return escapeHtml(truncate(t, maxTextLen))
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''

    const el = node as Element
    const tag = el.tagName.toLowerCase()

    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'link') return ''
    if (tag === 'svg') return '<svg/>'

    nodesEmitted++

    const attrs: string[] = []
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name
      if (name === 'style') continue
      if (name.startsWith('on')) continue
      // React/Emotion sometimes ship enormous data-emotion or data-styled-component blobs.
      if (name === 'data-emotion' || name === 'data-styled') continue
      const v = truncate(attr.value, maxAttrLen)
      attrs.push(`${name}="${escapeAttr(v)}"`)
    }
    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : ''

    if (selfClosing.has(tag)) return `<${tag}${attrStr}/>`

    const children: string[] = []
    for (const child of Array.from(el.childNodes)) {
      const s = emit(child, depth + 1)
      if (s) children.push(s)
    }
    return `<${tag}${attrStr}>${children.join('')}</${tag}>`
  }

  const body = emit(root, 0)
  const header = `<!-- url=${location.href} captured=${new Date().toISOString()} nodes=${nodesEmitted} max=${maxNodes} -->\n`
  const truncatedNote = nodesEmitted >= maxNodes ? '\n<!-- TRUNCATED at maxNodes -->' : ''
  return header + body + truncatedNote
}

const selfClosing = new Set(['br', 'img', 'input', 'hr', 'meta', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr'])

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
