import type { TiptapNode } from '../types'

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
  return matches ? matches.length : 0
}

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'codeBlock', 'tableCell', 'tableHeader', 'listItem', 'blockquote'])

/** Plain text of a Tiptap document, one block per line. Used for search indexing and word counts. */
export function tiptapToPlainText(node: TiptapNode): string {
  const out: string[] = []
  const walk = (n: TiptapNode): void => {
    if (n.type === 'text') {
      out.push(n.text ?? '')
      return
    }
    if (n.type === 'hardBreak') out.push('\n')
    n.content?.forEach(walk)
    if (BLOCK_TYPES.has(n.type)) out.push('\n')
  }
  walk(node)
  return out.join('').replace(/\n{2,}/g, '\n').trim()
}
