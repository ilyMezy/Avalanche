import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { FileWarning, Info, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { countWords } from '@shared/domain/text'
import type { TiptapNode } from '@shared/types'
import { openExternalLink, requestFlashcardDrafts, requestTaskFromSelection } from '@/app/actions'
import { useAppStore } from '@/app/store'
import { promptDialog } from '@/components/ui/dialogs'
import { EmptyState, SaveProblemBanner, Spinner, toast } from '@/components/ui/feedback'
import { call, errorMessage } from '@/lib/api'
import { invalidate } from '@/lib/useData'
import { isMod } from '@/lib/platform'
import { useSaver } from '@/lib/useSaver'
import { DocxToolbar } from './DocxToolbar'
import { DocumentImage, PageBreak } from './extensions'
import { SymbolDialog } from './SymbolDialog'
import { WritingPanel, WritingTools } from './writing-tools'
import { BOARD_HEIGHT, BOARD_WIDTH, parseDrawing, Whiteboard, type Drawing } from './Whiteboard'

const MAX_IMAGE_WIDTH = 600

function naturalSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new window.Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve({ width: 400, height: 300 })
    image.src = dataUrl
  })
}

/**
 * The rich-text document editor: Tiptap on a page-like canvas. The document is saved as a
 * real `.docx` by the main process. The page is a continuous sheet in this version;
 * pagination, headers, and footers are not implemented yet.
 */
export function DocxEditor({ entryId }: { entryId: string }): ReactNode {
  const saveState = useAppStore((state) => state.saveStates[entryId])
  const setStatusText = useAppStore((state) => state.setStatusText)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [importNotice, setImportNotice] = useState<string[] | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const version = useRef('')
  const pageAppearance = useAppStore((state) => state.settings?.docxPage ?? 'theme')
  // The open whiteboard: `editing` is true when it was opened from an existing drawing.
  const [symbols, setSymbols] = useState(false)
  // The writing check: findings are underlined only while its panel is open.
  const [checking, setChecking] = useState(false)
  const checkingRef = useRef(false)
  const [board, setBoard] = useState<{ initial: Drawing | null; editing: boolean } | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } }
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: false } }),
      DocumentImage.configure({ allowBase64: true, inline: false }),
      PageBreak,
      TextStyle,
      FontFamily,
      FontSize,
      WritingTools.configure({
        math: () => useAppStore.getState().settings?.autoMath ?? true,
        autocorrect: () => useAppStore.getState().settings?.autocorrect ?? true,
        completion: () => useAppStore.getState().settings?.wordCompletion ?? true,
        checking: () => checkingRef.current
      })
    ],
    editable: false,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { 'aria-label': 'Document', spellcheck: 'true' } }
  })

  const saver = useSaver(entryId, async (force) => {
    if (!editor) return
    const result = await call('documents.writeDocx', { id: entryId, doc: editor.getJSON() as TiptapNode, baseVersion: version.current, force })
    version.current = result.version
    invalidate('workspace')
  })

  useEffect(() => {
    if (!editor) return
    let cancelled = false
    setStatus('loading')
    call('documents.readDocx', { id: entryId }).then(
      (document) => {
        if (cancelled) return
        version.current = document.version
        // Loading is not an edit: it stays out of the undo history, so Undo can never blank the
        // document that was just opened.
        editor
          .chain()
          .setMeta('addToHistory', false)
          .setContent(document.doc ?? document.html ?? '', { emitUpdate: false })
          .run()
        editor.setEditable(true)
        saver.reset()
        setImportNotice(document.doc ? null : document.importWarnings)
        setStatus('ready')
      },
      (error: unknown) => {
        if (cancelled) return
        setLoadError(errorMessage(error))
        setStatus('error')
      }
    )
    return () => {
      cancelled = true
    }
  }, [editor, entryId, reloadCount, saver])

  useEffect(() => {
    if (!editor) return
    const onUpdate = (): void => saver.markDirty()
    const onStatus = (): void => {
      const { from, to, empty } = editor.state.selection
      const total = countWords(editor.getText())
      const selected = empty ? 0 : countWords(editor.state.doc.textBetween(from, to, ' '))
      setStatusText(entryId, selected > 0 ? `${selected} of ${total} words selected` : `${total} words`)
    }
    editor.on('update', onUpdate)
    editor.on('transaction', onStatus)
    onStatus()
    return () => {
      editor.off('update', onUpdate)
      editor.off('transaction', onStatus)
    }
  }, [editor, entryId, saver, setStatusText])

  const insertLink = useCallback(async () => {
    if (!editor) return
    const current = (editor.getAttributes('link').href as string | undefined) ?? ''
    if (editor.state.selection.empty && !current) {
      toast('Select the text you want to turn into a link first.')
      return
    }
    const href = await promptDialog({
      title: current ? 'Edit link' : 'Insert link',
      label: 'Web address',
      initialValue: current || 'https://',
      confirmLabel: 'Apply',
      validate: (value) => (/^(https?:\/\/|mailto:)\S+$/i.test(value) ? null : 'Enter an address starting with https://, http://, or mailto:')
    })
    if (href) editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }, [editor])

  const insertImage = useCallback(async () => {
    if (!editor) return
    try {
      const picked = await call('documents.pickImage')
      if (!picked) return
      const natural = await naturalSize(picked.dataUrl)
      const width = Math.min(natural.width, MAX_IMAGE_WIDTH)
      const height = Math.round((width / natural.width) * natural.height)
      editor.chain().focus().setImage({ src: picked.dataUrl, alt: picked.name, width, height }).run()
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }, [editor])

  const insertPageBreak = useCallback(() => {
    if (!editor) return
    if (!editor.chain().focus().insertPageBreak().run()) toast('Place the cursor in a paragraph outside tables and lists to add a page break.')
  }, [editor])

  /** Opens the whiteboard: on the selected drawing if there is one, otherwise empty. */
  const openWhiteboard = useCallback(() => {
    if (!editor) return
    const existing = editor.isActive('image') ? parseDrawing(editor.getAttributes('image').whiteboard as string | null) : null
    setBoard({ initial: existing, editing: existing !== null })
  }, [editor])

  const saveWhiteboard = useCallback(
    ({ dataUrl, drawing }: { dataUrl: string; drawing: Drawing }) => {
      if (!editor || !board) return
      // Shown at page width; the picture itself keeps the board's full resolution.
      const attrs = { src: dataUrl, alt: 'Drawing', width: MAX_IMAGE_WIDTH, height: Math.round((MAX_IMAGE_WIDTH / BOARD_WIDTH) * BOARD_HEIGHT), whiteboard: JSON.stringify(drawing) }
      const done = board.editing ? editor.chain().focus().updateAttributes('image', attrs).run() : editor.chain().focus().insertContent({ type: 'image', attrs }).run()
      if (!done) throw new Error('The drawing could not be placed at the cursor. Click in the document and try again.')
    },
    [editor, board]
  )

  const exportPdf = useCallback(async () => {
    if (!editor) return
    try {
      await saver.flush()
      const result = await call('documents.exportPdf', { id: entryId, html: editor.getHTML() })
      if (result) toast(`Exported to ${result.path}`)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }, [editor, entryId, saver])

  const makeFlashcards = useCallback(() => {
    if (!editor) return
    const { from, to } = editor.state.selection
    requestFlashcardDrafts(editor.state.doc.textBetween(from, to, '\n'), entryId)
  }, [editor, entryId])

  const addToPlanner = useCallback(() => {
    if (!editor) return
    const { from, to } = editor.state.selection
    requestTaskFromSelection(editor.state.doc.textBetween(from, to, '\n'))
  }, [editor])

  const toggleChecking = useCallback(() => {
    if (!editor) return
    checkingRef.current = !checkingRef.current
    setChecking(checkingRef.current)
    // An empty transaction makes the editor redraw its underlines for the new state.
    editor.view.dispatch(editor.state.tr)
  }, [editor])

  if (status === 'error') {
    return <EmptyState icon={<FileWarning size={18} />} title="This document could not be opened" body={loadError} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {editor && <DocxToolbar editor={editor} onInsertLink={() => void insertLink()} onInsertImage={() => void insertImage()} onFlashcards={makeFlashcards} onPageBreak={insertPageBreak} onWhiteboard={openWhiteboard} onSymbol={() => setSymbols(true)} onExportPdf={() => void exportPdf()} onPlanner={addToPlanner} onCheckWriting={toggleChecking} checking={checking} />}
      {symbols && editor && <SymbolDialog onInsert={(char) => editor.chain().focus().insertContent(char).run()} onClose={() => setSymbols(false)} />}
      {board && <Whiteboard initial={board.initial} onSave={saveWhiteboard} onClose={() => setBoard(null)} />}
      <SaveProblemBanner
        state={saveState}
        onReload={() => setReloadCount((count) => count + 1)}
        onOverwrite={() => void saver.overwrite()}
        onRetry={() => void saver.flush()}
      />
      {importNotice && (
        <div className="flex items-start gap-2.5 border-b border-line bg-raised px-4 py-2 text-xs text-muted" role="status">
          <Info size={14} className="mt-0.5 shrink-0 text-accent-text" />
          <span className="flex-1 leading-relaxed">
            This document was written by another program and has been converted for editing. Headings, emphasis, lists, links, tables, and
            images are kept; other formatting (for example alignment, fonts, and page layout) may not be. The original file is kept in the
            app&apos;s recovery folder the first time you save.
            {importNotice.length > 0 && ` Converter notes: ${importNotice.slice(0, 3).join(' · ')}`}
          </span>
          <button type="button" aria-label="Dismiss" className="text-subtle hover:text-fg" onClick={() => setImportNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
      <div
        className="@container min-h-0 min-w-0 flex-1 overflow-auto bg-canvas"
        onKeyDown={(event) => {
          if (isMod(event) && event.shiftKey && event.key.toLowerCase() === 'k') {
            event.preventDefault()
            makeFlashcards()
          } else if (isMod(event) && event.shiftKey && event.key.toLowerCase() === 'd') {
            event.preventDefault()
            addToPlanner()
          }
        }}
        onClick={(event) => {
          const anchor = (event.target as HTMLElement).closest('a')
          if (!anchor) return
          event.preventDefault()
          // Links are followed only on Ctrl+click (Cmd+click on macOS), and then only after a confirmation.
          if (isMod(event)) void openExternalLink(anchor.getAttribute('href') ?? '')
        }}
      >
        {status === 'loading' ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="docx-page" data-appearance={pageAppearance === 'paper' ? 'paper' : undefined} data-testid="docx-page" onMouseDown={(event) => event.target === event.currentTarget && editor?.commands.focus('end')}>
            <EditorContent editor={editor} />
          </div>
        )}
      </div>
      {checking && editor && <WritingPanel editor={editor} onClose={toggleChecking} />}
      </div>
    </div>
  )
}
