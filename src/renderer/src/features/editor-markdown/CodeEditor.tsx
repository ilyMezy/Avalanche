import { autoResult } from '@shared/domain/calc'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { bracketMatching, HighlightStyle, indentOnInput, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type KeyBinding } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { useEffect, useRef, type ReactNode } from 'react'
import { useAppStore } from '@/app/store'

// One CodeMirror 6 setup shared by the Markdown editor and the LaTeX source editor. Colours
// come from CSS variables, so the editor follows the app's light and dark themes.

const highlightStyle = HighlightStyle.define([
  { tag: t.heading, fontWeight: '650', color: 'var(--syn-heading)' },
  { tag: t.heading1, fontSize: '1.45em' },
  { tag: t.heading2, fontSize: '1.25em' },
  { tag: t.heading3, fontSize: '1.1em' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--syn-link)' },
  { tag: [t.keyword, t.tagName], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.monospace], color: 'var(--syn-string)' },
  { tag: [t.comment, t.meta, t.processingInstruction], color: 'var(--syn-comment)' },
  { tag: [t.atom, t.number, t.bracket], color: 'var(--syn-atom)' },
  { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' }
])

const fontTheme = (size: number) => EditorView.theme({ '.cm-content, .cm-gutters': { fontSize: `${size}px` } })

export interface CodeEditorProps {
  initialDoc: string
  mode: 'markdown' | 'latex'
  onChange(doc: string): void
  onCursor?(line: number, column: number): void
  onReady?(view: EditorView): void
  keys?: KeyBinding[]
}

/** The document is set once at mount; parents remount (with a new `key`) to load different content. */
export function CodeEditor({ initialDoc, mode, onChange, onCursor, onReady, keys }: CodeEditorProps): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const fontCompartment = useRef(new Compartment())
  const callbacks = useRef({ onChange, onCursor, onReady, keys })
  callbacks.current = { onChange, onCursor, onReady, keys }
  const fontSize = useAppStore((state) => state.settings?.editorFontSize ?? 14)

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          EditorView.lineWrapping,
          syntaxHighlighting(highlightStyle),
          fontCompartment.current.of(fontTheme(useAppStore.getState().settings?.editorFontSize ?? 14)),
          ...(mode === 'markdown'
            ? [
                markdown({ base: markdownLanguage }),
                EditorView.editorAttributes.of({ class: 'cm-prose' }),
                // A sum followed by "=" and a space gets its answer, as in the document editor.
                EditorView.inputHandler.of((view, from, to, text) => {
                  if (text !== ' ' || from !== to || useAppStore.getState().settings?.autoMath === false) return false
                  const line = view.state.doc.lineAt(from)
                  const before = line.text.slice(0, from - line.from)
                  const result = before.endsWith('=') ? autoResult(before) : null
                  if (result === null) return false
                  view.dispatch({ changes: { from, insert: `${result} ` }, selection: { anchor: from + result.length + 1 }, userEvent: 'input.type' })
                  return true
                })
              ]
            : [StreamLanguage.define(stex), lineNumbers(), highlightActiveLineGutter()]),
          keymap.of([...(callbacks.current.keys ?? []), ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString())
            if (update.docChanged || update.selectionSet) {
              const head = update.state.selection.main.head
              const line = update.state.doc.lineAt(head)
              callbacks.current.onCursor?.(line.number, head - line.from + 1)
            }
          })
        ]
      })
    })
    viewRef.current = view
    callbacks.current.onReady?.(view)
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // The editor is created once; content changes arrive through a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: fontCompartment.current.reconfigure(fontTheme(fontSize)) })
  }, [fontSize])

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />
}
