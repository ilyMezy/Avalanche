import Image from '@tiptap/extension-image'
import { mergeAttributes, Node } from '@tiptap/react'

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Inserts a page break after the current top-level block. */
      insertPageBreak: () => ReturnType
    }
  }
}

/**
 * An explicit page break as a real node in the document model (not spacing or a rule).
 * It is saved with the document, written to DOCX as a WordprocessingML page break, and turned
 * into real pagination when printing to PDF. It is an atom: it holds no text, so nothing about
 * it can leak into the document as visible characters, and undo/redo treat it as one step.
 */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  // Wins over the hard-break binding that the starter kit also puts on Mod-Enter.
  priority: 1000,

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': 'true', contenteditable: 'false' })]
  },

  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ state, chain }) => {
          // Page breaks belong between top-level blocks. Inside a table cell or list item the
          // command does nothing, rather than splitting the table or list unexpectedly.
          const { $from } = state.selection
          if ($from.depth !== 1) return false
          return chain()
            .insertContentAt($from.after(1), [{ type: this.name }, { type: 'paragraph' }])
            .setTextSelection($from.after(1) + 2)
            .scrollIntoView()
            .run()
        }
    }
  },

  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.insertPageBreak() }
  }
})

/**
 * The image node, extended so a drawing made on the whiteboard keeps its editable shapes
 * (as JSON in `whiteboard`) next to the rendered picture. The picture is what is exported;
 * the shapes only let the drawing be reopened and changed later.
 */
export const DocumentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      whiteboard: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-whiteboard'),
        renderHTML: (attributes) => (attributes.whiteboard ? { 'data-whiteboard': attributes.whiteboard as string } : {})
      }
    }
  }
})
