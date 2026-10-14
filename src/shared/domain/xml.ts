// A small, tolerant XML reader for the parts of Office files this app imports. It builds a
// plain tree and nothing else: document type declarations are skipped and only the five
// predefined entities and numeric character references are decoded, so a hostile file cannot
// make it expand entities or fetch anything.

export interface XmlNode {
  /** Qualified name as written, for example `a:t`. */
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  /** Text directly inside this element (not inside its children). */
  text: string
}

const TOKEN =
  /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\/([^\s>]+)\s*>|<([^\s>/]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
const ATTRIBUTE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const MAX_DEPTH = 256

export function decodeXmlText(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return NAMED[body.toLowerCase()] ?? whole
  })
}

/** Parses a document and returns a synthetic root whose children are the top-level elements. */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  TOKEN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN.exec(source)) !== null) {
    const top = stack[stack.length - 1]
    const [, cdata, closing, opening, attributes, selfClosing, text] = match
    if (cdata !== undefined) {
      top.text += cdata
    } else if (closing !== undefined) {
      // A stray closing tag is ignored rather than unwinding past the root.
      if (stack.length > 1 && top.name === closing) stack.pop()
    } else if (opening !== undefined) {
      const node: XmlNode = { name: opening, attrs: {}, children: [], text: '' }
      if (attributes) {
        ATTRIBUTE.lastIndex = 0
        let attribute: RegExpExecArray | null
        while ((attribute = ATTRIBUTE.exec(attributes)) !== null) node.attrs[attribute[1]] = decodeXmlText(attribute[2] ?? attribute[3] ?? '')
      }
      top.children.push(node)
      if (!selfClosing) {
        if (stack.length >= MAX_DEPTH) throw new Error('The file is nested too deeply to read.')
        stack.push(node)
      }
    } else if (text !== undefined) {
      top.text += decodeXmlText(text)
    }
  }
  return root
}

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((candidate) => candidate.name === name)
}

/** Follows a path of element names, for example `path(sp, 'p:spPr', 'a:xfrm')`. */
export function path(node: XmlNode | undefined, ...names: string[]): XmlNode | undefined {
  let current = node
  for (const name of names) current = child(current, name)
  return current
}

export function childrenNamed(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((candidate) => candidate.name === name) : []
}

/** Every descendant with the given name, in document order. */
export function descendants(node: XmlNode | undefined, name: string, out: XmlNode[] = []): XmlNode[] {
  if (!node) return out
  for (const candidate of node.children) {
    if (candidate.name === name) out.push(candidate)
    descendants(candidate, name, out)
  }
  return out
}
