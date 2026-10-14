import type { EditorView } from '@codemirror/view'
import MarkdownIt from 'markdown-it'

// Local Markdown rendering: CommonMark plus GitHub-flavoured tables, strikethrough, and
// task-list checkboxes. Raw HTML in the source is escaped (html: false), so scripts, event
// handlers, and frames can never reach the preview (spec MD-13).

const md = new MarkdownIt({ html: false, linkify: true, typographer: false })

md.core.ruler.after('inline', 'task-lists', (state) => {
  const tokens = state.tokens
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue
    const match = /^\[([ xX])\]\s+/.exec(inline.content)
    const first = inline.children?.[0]
    if (!match || !first || first.type !== 'text') continue
    first.content = first.content.slice(match[0].length)
    inline.content = inline.content.slice(match[0].length)
    const checkbox = new state.Token('html_inline', '', 0)
    const line = tokens[i - 2].map?.[0] ?? -1
    checkbox.content = `<input type="checkbox" data-line="${line}"${match[1] === ' ' ? '' : ' checked'}>`
    inline.children!.unshift(checkbox)
    tokens[i - 2].attrJoin('class', 'task-item')
  }
})

// Images are not loaded from the network, and relative paths are not resolved yet, so only
// embedded data: images are shown; anything else is replaced by a text placeholder.
md.renderer.rules.image = (tokens, index) => {
  const token = tokens[index]
  const src = String(token.attrGet('src') ?? '')
  const alt = md.utils.escapeHtml(token.content || 'image')
  if (/^data:image\/(png|jpeg|gif|webp);base64,/.test(src)) return `<img src="${md.utils.escapeHtml(src)}" alt="${alt}">`
  return `<code>[image: ${alt}]</code>`
}

export function renderMarkdown(source: string): string {
  return md.render(source)
}

/** Wraps the selection in a marker such as `**`, or removes the marker when it is already there. */
export function toggleWrap(view: EditorView, marker: string): boolean {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)
  const before = view.state.sliceDoc(Math.max(0, from - marker.length), from)
  const after = view.state.sliceDoc(to, to + marker.length)
  if (before === marker && after === marker) {
    view.dispatch({
      changes: [
        { from: from - marker.length, to: from },
        { from: to, to: to + marker.length }
      ]
    })
  } else {
    view.dispatch({
      changes: { from, to, insert: `${marker}${selected}${marker}` },
      selection: { anchor: from + marker.length, head: to + marker.length }
    })
  }
  view.focus()
  return true
}

const LINE_PREFIX = /^(\s*)(#{1,6}\s+|>\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/

/** Sets (or removes, when already present) a block prefix on every selected line. */
export function toggleLinePrefix(view: EditorView, prefix: string): boolean {
  const { from, to } = view.state.selection.main
  const first = view.state.doc.lineAt(from).number
  const last = view.state.doc.lineAt(to).number
  const changes = []
  for (let number = first; number <= last; number++) {
    const line = view.state.doc.line(number)
    const match = LINE_PREFIX.exec(line.text)!
    const indent = match[1]
    const existing = match[2] ?? ''
    const next = existing === prefix ? '' : prefix.startsWith('1.') ? `${number - first + 1}. ` : prefix
    changes.push({ from: line.from + indent.length, to: line.from + indent.length + existing.length, insert: next })
  }
  view.dispatch({ changes })
  view.focus()
  return true
}

export function insertLink(view: EditorView): boolean {
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to) || 'link text'
  const insert = `[${text}](https://)`
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + text.length + 3, head: from + insert.length - 1 }
  })
  view.focus()
  return true
}

export function insertBlock(view: EditorView, block: string): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const lead = line.text.trim() === '' ? '' : '\n\n'
  const at = line.text.trim() === '' ? line.from : line.to
  view.dispatch({ changes: { from: at, insert: `${lead}${block}\n` }, selection: { anchor: at + lead.length + block.length } })
  view.focus()
  return true
}

export const TABLE_SNIPPET = '| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |'
export const CODE_SNIPPET = '```\ncode\n```'

/** Toggles the `[ ]` / `[x]` marker on a source line (0-based), used by preview checkboxes. */
export function toggleTaskAtLine(view: EditorView, lineIndex: number): void {
  if (lineIndex < 0 || lineIndex >= view.state.doc.lines) return
  const line = view.state.doc.line(lineIndex + 1)
  const match = /\[([ xX])\]/.exec(line.text)
  if (!match) return
  const at = line.from + match.index + 1
  view.dispatch({ changes: { from: at, to: at + 1, insert: match[1] === ' ' ? 'x' : ' ' } })
}
