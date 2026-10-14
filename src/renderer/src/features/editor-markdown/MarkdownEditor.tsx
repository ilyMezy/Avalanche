import type { EditorView, KeyBinding } from '@codemirror/view'
import { Bold, Code, Columns2, Eye, Heading, Italic, Layers, Link, List, ListChecks, ListOrdered, PencilLine, Quote, Strikethrough, Table, CalendarPlus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { countWords } from '@shared/domain/text'
import { openExternalLink, requestFlashcardDrafts, requestTaskFromSelection } from '@/app/actions'
import { useAppStore } from '@/app/store'
import { IconButton } from '@/components/ui/button'
import { Segmented } from '@/components/ui/controls'
import { EmptyState, SaveProblemBanner, Spinner } from '@/components/ui/feedback'
import { call, errorMessage } from '@/lib/api'
import { invalidate } from '@/lib/useData'
import { useSaver } from '@/lib/useSaver'
import { cn } from '@/lib/utils'
import { CodeEditor } from './CodeEditor'
import { CODE_SNIPPET, insertBlock, insertLink, renderMarkdown, TABLE_SNIPPET, toggleLinePrefix, toggleTaskAtLine, toggleWrap } from './markdown'

type PreviewMode = 'off' | 'split' | 'preview'

/**
 * The Markdown editor: CodeMirror source editing with an optional rendered preview. Used for
 * full-size documents in tabs and, in `compact` form, inside Quick Notes.
 */
export function MarkdownEditor({ entryId, compact = false }: { entryId: string; compact?: boolean }): ReactNode {
  const defaultPreview = useAppStore((state) => state.settings?.markdownPreview ?? 'off')
  const saveState = useAppStore((state) => state.saveStates[entryId])
  const setStatusText = useAppStore((state) => state.setStatusText)
  const [loaded, setLoaded] = useState<{ content: string; nonce: number } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [preview, setPreview] = useState<PreviewMode>(compact ? 'off' : defaultPreview)
  const [html, setHtml] = useState('')
  const viewRef = useRef<EditorView | null>(null)
  const content = useRef('')
  const version = useRef('')
  const cursor = useRef({ line: 1, column: 1 })
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saver = useSaver(entryId, async (force) => {
    const result = await call('documents.writeText', { id: entryId, content: content.current, baseVersion: version.current, force })
    version.current = result.version
    invalidate('workspace')
  })

  useEffect(() => {
    let cancelled = false
    call('documents.readText', { id: entryId }).then(
      (document) => {
        if (cancelled) return
        content.current = document.content
        version.current = document.version
        saver.reset()
        setHtml(renderMarkdown(document.content))
        setLoadError(null)
        setLoaded({ content: document.content, nonce: Date.now() })
      },
      (error: unknown) => !cancelled && setLoadError(errorMessage(error))
    )
    return () => {
      cancelled = true
    }
  }, [entryId, reloadCount, saver])

  const updateStatus = useCallback(() => {
    setStatusText(entryId, `${countWords(content.current)} words  ·  Ln ${cursor.current.line}, Col ${cursor.current.column}`)
  }, [entryId, setStatusText])

  const onChange = useCallback(
    (doc: string) => {
      content.current = doc
      saver.markDirty()
      updateStatus()
      if (previewTimer.current) clearTimeout(previewTimer.current)
      previewTimer.current = setTimeout(() => setHtml(renderMarkdown(content.current)), 120)
    },
    [saver, updateStatus]
  )

  const withView = (action: (view: EditorView) => void) => () => viewRef.current && action(viewRef.current)
  const makeFlashcards = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    requestFlashcardDrafts(view.state.sliceDoc(from, to), entryId)
  }, [entryId])

  const keys = useMemo<KeyBinding[]>(
    () => [
      { key: 'Mod-b', run: (view) => toggleWrap(view, '**') },
      { key: 'Mod-i', run: (view) => toggleWrap(view, '*') },
      { key: 'Mod-e', run: (view) => toggleWrap(view, '`') },
      {
        key: 'Mod-Shift-v',
        run: () => {
          setPreview((mode) => (mode === 'off' ? 'split' : mode === 'split' ? 'preview' : 'off'))
          return true
        }
      },
      {
        key: 'Mod-Shift-k',
        run: () => {
          makeFlashcards()
          return true
        }
      }
    ],
    [makeFlashcards]
  )

  const onPreviewClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    if (target instanceof HTMLInputElement && target.dataset.line !== undefined) {
      // Toggling a checkbox in the preview edits the source line it came from.
      if (viewRef.current) toggleTaskAtLine(viewRef.current, Number(target.dataset.line))
      return
    }
    const anchor = target.closest('a')
    if (anchor) {
      event.preventDefault()
      const href = anchor.getAttribute('href') ?? ''
      if (/^(https?:|mailto:)/i.test(href)) void openExternalLink(href)
    }
  }

  if (loadError) {
    return <EmptyState icon={<PencilLine size={18} />} title="This note could not be opened" body={loadError} />
  }
  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('flex h-10 shrink-0 items-center gap-0.5 border-b border-line px-3', compact && 'h-9 px-2')} role="toolbar" aria-label="Formatting">
        <IconButton label="Bold" shortcut="Ctrl+B" onClick={withView((view) => toggleWrap(view, '**'))}>
          <Bold size={15} />
        </IconButton>
        <IconButton label="Italic" shortcut="Ctrl+I" onClick={withView((view) => toggleWrap(view, '*'))}>
          <Italic size={15} />
        </IconButton>
        <IconButton label="Strikethrough" onClick={withView((view) => toggleWrap(view, '~~'))}>
          <Strikethrough size={15} />
        </IconButton>
        <IconButton label="Inline code" shortcut="Ctrl+E" onClick={withView((view) => toggleWrap(view, '`'))}>
          <Code size={15} />
        </IconButton>
        <span className="mx-1.5 h-4 w-px bg-line" />
        <IconButton label="Heading" onClick={withView((view) => toggleLinePrefix(view, '## '))}>
          <Heading size={15} />
        </IconButton>
        <IconButton label="Bulleted list" onClick={withView((view) => toggleLinePrefix(view, '- '))}>
          <List size={15} />
        </IconButton>
        <IconButton label="Numbered list" onClick={withView((view) => toggleLinePrefix(view, '1. '))}>
          <ListOrdered size={15} />
        </IconButton>
        <IconButton label="Checklist" onClick={withView((view) => toggleLinePrefix(view, '- [ ] '))}>
          <ListChecks size={15} />
        </IconButton>
        <IconButton label="Quote" onClick={withView((view) => toggleLinePrefix(view, '> '))}>
          <Quote size={15} />
        </IconButton>
        <span className="mx-1.5 h-4 w-px bg-line" />
        <IconButton label="Link" onClick={withView(insertLink)}>
          <Link size={15} />
        </IconButton>
        <IconButton label="Table" onClick={withView((view) => insertBlock(view, TABLE_SNIPPET))}>
          <Table size={15} />
        </IconButton>
        <IconButton label="Code block" onClick={withView((view) => insertBlock(view, CODE_SNIPPET))}>
          <Code size={15} strokeWidth={2.6} />
        </IconButton>
        <span className="mx-1.5 h-4 w-px bg-line" />
        <IconButton label="Create flashcards from selection" shortcut="Ctrl+Shift+K" onClick={makeFlashcards}>
          <Layers size={15} />
        </IconButton>
        <IconButton
          label="Add selection to planner"
          onClick={withView((view) => {
            const { from, to } = view.state.selection.main
            requestTaskFromSelection(view.state.sliceDoc(from, to))
          })}
        >
          <CalendarPlus size={15} />
        </IconButton>
        <span className="flex-1" />
        <Segmented<PreviewMode>
          label="Preview mode"
          size="sm"
          value={preview}
          onChange={setPreview}
          options={[
            { value: 'off', label: 'Source', icon: <PencilLine size={12} /> },
            { value: 'split', label: 'Split', icon: <Columns2 size={12} /> },
            { value: 'preview', label: 'Preview', icon: <Eye size={12} /> }
          ]}
        />
      </div>
      <SaveProblemBanner
        state={saveState}
        onReload={() => setReloadCount((count) => count + 1)}
        onOverwrite={() => void saver.overwrite()}
        onRetry={() => void saver.flush()}
      />
      <div className="flex min-h-0 flex-1">
        <div className={cn('min-w-0 flex-1', preview === 'preview' && 'hidden')} data-testid="markdown-source">
          <CodeEditor
            key={loaded.nonce}
            mode="markdown"
            initialDoc={loaded.content}
            keys={keys}
            onChange={onChange}
            onCursor={(line, column) => {
              cursor.current = { line, column }
              updateStatus()
            }}
            onReady={(view) => {
              viewRef.current = view
              updateStatus()
            }}
          />
        </div>
        {preview !== 'off' && (
          <div className={cn('min-w-0 flex-1 overflow-y-auto', preview === 'split' && 'border-l border-line')}>
            <div className="md-preview" data-testid="markdown-preview" onClick={onPreviewClick} dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        )}
      </div>
    </div>
  )
}
