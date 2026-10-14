import type { Node as ProseNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Extension, type Editor } from '@tiptap/react'
import { Check, SpellCheck, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { autoResult } from '@shared/domain/calc'
import { autocorrectTail, checkWriting, completeWord, wordFrequencies, type WritingIssue } from '@shared/domain/writing'
import { Button, IconButton } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Writing help for the document editor. Everything here runs locally from fixed rules:
//   - a sum followed by "=" and a space (or Enter) gets its answer;
//   - common slips are corrected, and sentences capitalized, as each word is finished;
//   - the word being typed can be completed (Tab) from words already used in the document;
//   - grammar and punctuation findings are underlined while the checking panel is open.

export interface WritingOptions {
  math(): boolean
  autocorrect(): boolean
  completion(): boolean
  /** Whether the checking panel is open, and so whether findings are underlined. */
  checking(): boolean
}

const LEAF = '￼'
const MAX_DOC_FOR_COMPLETION = 400_000

/** The text of the current paragraph up to the cursor, or null when the cursor is not in plain text. */
function textBefore(state: EditorState): { before: string; after: string } | null {
  const { $from, empty } = state.selection
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return null
  return {
    before: $from.parent.textBetween(0, $from.parentOffset, undefined, LEAF),
    after: $from.parent.textBetween($from.parentOffset, $from.parent.content.size, undefined, LEAF)
  }
}

const frequencyCache = new WeakMap<ProseNode, Map<string, number>>()

/** The rest of the word at the cursor, if the document already contains a longer word starting the same way. */
function completionFor(state: EditorState): string | null {
  if (state.doc.content.size > MAX_DOC_FOR_COMPLETION) return null
  const text = textBefore(state)
  if (!text || /^[A-Za-z']/.test(text.after)) return null
  const prefix = /([A-Za-z]+)$/.exec(text.before)?.[1]
  if (!prefix) return null
  let counts = frequencyCache.get(state.doc)
  if (!counts) {
    counts = wordFrequencies(state.doc.textBetween(0, state.doc.content.size, ' ', ' '))
    frequencyCache.set(state.doc, counts)
  }
  return completeWord(prefix, counts)
}

export interface LocatedIssue extends WritingIssue {
  /** Document positions of the finding. */
  docFrom: number
  docTo: number
  /** The sentence around the finding, for the panel. */
  context: string
}

/** Every finding in the document, in order. Offsets in a paragraph map one to one onto positions. */
export function collectIssues(doc: ProseNode): LocatedIssue[] {
  const out: LocatedIssue[] = []
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true
    if (node.type.spec.code) return false
    const text = node.textBetween(0, node.content.size, undefined, LEAF)
    for (const issue of checkWriting(text)) {
      const start = Math.max(0, issue.from - 30)
      out.push({
        ...issue,
        docFrom: position + 1 + issue.from,
        docTo: position + 1 + issue.to,
        context: `${start > 0 ? '…' : ''}${text.slice(start, issue.to + 30)}${issue.to + 30 < text.length ? '…' : ''}`.replaceAll(LEAF, ' ')
      })
    }
    return false
  })
  return out
}

const issueCache = new WeakMap<ProseNode, DecorationSet>()

export const WritingTools = Extension.create<WritingOptions>({
  name: 'writingTools',

  addOptions() {
    return { math: () => true, autocorrect: () => true, completion: () => true, checking: () => false }
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin({
        key: new PluginKey('writingTools'),
        props: {
          handleTextInput(view, from, to, typed) {
            if (from !== to) return false
            const text = textBefore(view.state)
            if (!text) return false
            if (typed === ' ' && options.math() && text.before.endsWith('=')) {
              const result = autoResult(text.before)
              if (result !== null) {
                view.dispatch(view.state.tr.insertText(`${result} `, from))
                return true
              }
            }
            if (options.autocorrect() && /^[\s.,;:!?)]$/.test(typed)) {
              const fix = autocorrectTail(text.before, typed)
              if (fix) {
                view.dispatch(view.state.tr.insertText(fix.replacement + typed, from - fix.word.length, from))
                return true
              }
            }
            return false
          },
          handleKeyDown(view, event) {
            if (event.ctrlKey || event.metaKey || event.altKey) return false
            if (event.key === 'Tab' && !event.shiftKey && options.completion()) {
              const rest = completionFor(view.state)
              if (rest) {
                view.dispatch(view.state.tr.insertText(rest, view.state.selection.from))
                return true
              }
            }
            if (event.key === 'Enter' && options.math()) {
              const text = textBefore(view.state)
              const result = text && text.before.endsWith('=') ? autoResult(text.before) : null
              // The answer is written, then Enter carries on and starts the new line.
              if (result !== null) view.dispatch(view.state.tr.insertText(result, view.state.selection.from))
            }
            return false
          },
          decorations(state) {
            const sets: Decoration[] = []
            if (options.completion()) {
              const rest = completionFor(state)
              if (rest) {
                sets.push(
                  Decoration.widget(
                    state.selection.from,
                    () => {
                      const ghost = document.createElement('span')
                      ghost.className = 'word-completion'
                      ghost.textContent = rest
                      ghost.setAttribute('data-testid', 'word-completion')
                      ghost.setAttribute('aria-hidden', 'true')
                      return ghost
                    },
                    { side: 1, key: `completion-${rest}` }
                  )
                )
              }
            }
            if (!options.checking()) return sets.length ? DecorationSet.create(state.doc, sets) : null
            let marks = issueCache.get(state.doc)
            if (!marks) {
              marks = DecorationSet.create(
                state.doc,
                collectIssues(state.doc).map((issue) => Decoration.inline(issue.docFrom, issue.docTo, { class: `writing-issue writing-issue-${issue.kind}`, title: issue.message }))
              )
              issueCache.set(state.doc, marks)
            }
            return sets.length ? marks.add(state.doc, sets) : marks
          }
        }
      })
    ]
  }
})

const KIND_LABEL: Record<WritingIssue['kind'], string> = { grammar: 'Grammar', punctuation: 'Punctuation', style: 'Style' }

/**
 * The checking panel beside the document: every finding with its fix. The list follows the
 * document as it is edited.
 */
export function WritingPanel({ editor, onClose }: { editor: Editor; onClose(): void }): ReactNode {
  const [issues, setIssues] = useState<LocatedIssue[]>(() => collectIssues(editor.state.doc))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setIssues(collectIssues(editor.state.doc)), 200)
    }
    editor.on('update', refresh)
    return () => {
      editor.off('update', refresh)
      if (timer) clearTimeout(timer)
    }
  }, [editor])

  const fixable = issues.filter((issue) => issue.replacement !== null)
  const show = (issue: LocatedIssue): void => {
    editor.chain().setTextSelection({ from: issue.docFrom, to: issue.docTo }).scrollIntoView().run()
  }
  const fix = (issue: LocatedIssue): void => {
    if (issue.replacement === null) return
    editor.view.dispatch(editor.state.tr.insertText(issue.replacement, issue.docFrom, issue.docTo))
    setIssues(collectIssues(editor.state.doc))
  }
  const fixAll = (): void => {
    // Applied from the end of the document backwards, so earlier positions stay valid.
    let transaction = editor.state.tr
    for (const issue of [...fixable].sort((a, b) => b.docFrom - a.docFrom)) transaction = transaction.insertText(issue.replacement!, issue.docFrom, issue.docTo)
    editor.view.dispatch(transaction)
    setIssues(collectIssues(editor.state.doc))
  }

  return (
    <aside aria-label="Writing check" className="flex w-[300px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3.5">
        <SpellCheck size={14} className="text-accent-text" />
        <span className="flex-1 text-xs font-medium text-fg" data-testid="writing-count">
          {issues.length === 0 ? 'No findings' : `${issues.length} ${issues.length === 1 ? 'finding' : 'findings'}`}
        </span>
        {fixable.length > 1 && (
          <Button size="sm" onClick={fixAll}>
            Fix all ({fixable.length})
          </Button>
        )}
        <IconButton label="Close writing check" className="h-7 w-7" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {issues.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs text-muted">
            <Check size={18} className="text-success" />
            Nothing was found by the built-in checks.
          </div>
        )}
        {issues.map((issue, index) => (
          <div key={`${issue.docFrom}-${index}`} data-testid="writing-issue" className="mb-1.5 rounded-lg border border-line bg-bg p-2.5">
            <button type="button" className="block w-full text-left" onClick={() => show(issue)}>
              <span className={cn('text-[10.5px] font-semibold tracking-wide uppercase', issue.kind === 'style' ? 'text-muted' : issue.kind === 'punctuation' ? 'text-warning' : 'text-accent-text')}>
                {KIND_LABEL[issue.kind]}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-fg">{issue.message}</span>
              <span className="mt-1 block truncate text-[11px] text-subtle">{issue.context}</span>
            </button>
            {issue.replacement !== null && (
              <Button size="sm" className="mt-2" onClick={() => fix(issue)}>
                Change to “{issue.replacement.trim() === '' ? 'one space' : issue.replacement}”
              </Button>
            )}
          </div>
        ))}
        <p className="px-1 pt-2 text-[11px] leading-relaxed text-subtle">
          These are fixed rules for English, checked on this computer. They catch common slips, not everything. Spelling is underlined in red by Windows; right-click a word for suggestions.
        </p>
      </div>
    </aside>
  )
}
