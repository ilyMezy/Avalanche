// Minimal HTML handling for imported flashcard text. Study data exported from other tools
// often carries basic markup (<b>, <br>, <i>, lists). It is shown through an allowlist:
// only the tags below are emitted, always without attributes, and every other character is
// escaped. Scripts, styles, event handlers, frames, and links can therefore never reach the page.

const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'br', 'p', 'div', 'span', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'hr'])
const VOID = new Set(['br', 'hr'])
// Elements whose whole content is discarded, not just the tags.
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|svg|math|template|noscript|head|title)\b[\s\S]*?(?:<\/\1\s*>|$)/gi
const TAG = /<!--[\s\S]*?(?:-->|$)|<\/?([a-zA-Z][a-zA-Z0-9]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/g

function escapeText(text: string): string {
  return text
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function looksLikeHtml(text: string): boolean {
  return /<\/?[a-zA-Z][a-zA-Z0-9]*\b[^>]*>|&(?:[a-zA-Z]{2,8}|#\d{1,6});/.test(text)
}

/** Returns HTML that contains only allowlisted, attribute-free tags and escaped text. */
export function sanitizeBasicHtml(input: string): string {
  const source = input.replace(DROP_WITH_CONTENT, '')
  let out = ''
  let last = 0
  TAG.lastIndex = 0
  for (let match = TAG.exec(source); match; match = TAG.exec(source)) {
    out += escapeText(source.slice(last, match.index))
    last = match.index + match[0].length
    const name = match[1]?.toLowerCase()
    if (!name || !ALLOWED.has(name)) continue
    const closing = match[0].startsWith('</')
    if (VOID.has(name)) {
      if (!closing) out += `<${name}>`
    } else {
      out += closing ? `</${name}>` : `<${name}>`
    }
  }
  return out + escapeText(source.slice(last))
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Plain text of a possibly-HTML string, for previews, search, and duplicate matching. */
export function stripHtml(input: string): string {
  if (!looksLikeHtml(input)) return input
  return input
    .replace(DROP_WITH_CONTENT, '')
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(TAG, '')
    .replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, code: string) => {
      if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole
      const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole
    })
}
