import type { EditorView, KeyBinding } from '@codemirror/view'
import { AlertTriangle, CheckCircle2, CircleAlert, FileCode2, FilePlus2, FileText, Folder, FolderTree, Layers, Play, TerminalSquare, Trash2, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { validateName } from '@shared/domain/naming'
import type { CompileResult, LatexProject, TexToolchain } from '@shared/types'
import { requestFlashcardDrafts } from '@/app/actions'
import { useAppStore } from '@/app/store'
import { Button, IconButton } from '@/components/ui/button'
import { confirmDialog, promptDialog } from '@/components/ui/dialogs'
import { EmptyState, SaveProblemBanner, Spinner, toast } from '@/components/ui/feedback'
import { CodeEditor } from '@/features/editor-markdown/CodeEditor'
import { call, errorMessage } from '@/lib/api'
import { useSaver } from '@/lib/useSaver'
import { cn } from '@/lib/utils'
import { PdfPreview } from './PdfPreview'

function validateFileName(value: string): string | null {
  const parts = value.split('/')
  for (const part of parts) {
    const problem = validateName(part)
    if (problem) return problem
  }
  return /\.(tex|bib|cls|sty|bst|txt|md)$/i.test(value) ? null : 'Use one of these extensions: .tex, .bib, .cls, .sty, .bst, .txt, .md'
}

/** Shown in the preview pane when no PDF exists yet, or when no TeX compiler is installed. */
function PreviewPlaceholder({ toolchain, compiling }: { toolchain: TexToolchain | null; compiling: boolean }): ReactNode {
  if (compiling) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-muted">
        <Spinner size={18} />
        Compiling…
      </div>
    )
  }
  if (toolchain && !toolchain.available) {
    return (
      <EmptyState
        icon={<Wrench size={18} />}
        title="No TeX compiler found"
        body="Compiling to PDF needs a TeX distribution (such as MiKTeX or TeX Live) installed on this computer. You can still write and organize the project here. After installing one, restart the app and press Compile. Nothing is downloaded by this app."
      />
    )
  }
  return (
    <EmptyState icon={<FileText size={18} />} title="No PDF yet" body="Press Compile (Ctrl+Enter) to build the project with your local TeX engine." />
  )
}

/**
 * The LaTeX workspace: project file tree, CodeMirror source editor, PDF preview, and a
 * compilation panel. One tab represents the whole project; files switch inside it.
 */
export function LatexWorkspace({ entryId, active }: { entryId: string; active: boolean }): ReactNode {
  const saveState = useAppStore((state) => state.saveStates[entryId])
  const setStatusText = useAppStore((state) => state.setStatusText)
  const [project, setProject] = useState<LatexProject | null>(null)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [toolchain, setToolchain] = useState<TexToolchain | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<{ file: string; content: string; nonce: number } | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [compiling, setCompiling] = useState(false)
  const [result, setResult] = useState<CompileResult | null>(null)
  const [pdf, setPdf] = useState<Uint8Array | null>(null)
  const [showRawLog, setShowRawLog] = useState(false)
  // In a narrow window the file list starts hidden so the source has room; the button shows it.
  const narrow = useAppStore((state) => state.narrow)
  const [filesChoice, setFilesChoice] = useState<boolean | null>(null)
  const filesShown = filesChoice ?? !narrow
  const viewRef = useRef<EditorView | null>(null)
  const content = useRef('')
  const version = useRef('')
  const fileRef = useRef<string | null>(null)
  const cursor = useRef({ line: 1, column: 1 })

  const saver = useSaver(entryId, async (force) => {
    if (!fileRef.current) return
    const saved = await call('latex.writeFile', { id: entryId, file: fileRef.current, content: content.current, baseVersion: version.current, force })
    version.current = saved.version
  })

  const refreshProject = useCallback(async (): Promise<LatexProject | null> => {
    try {
      const info = await call('latex.project', { id: entryId })
      setProject(info)
      setProjectError(null)
      return info
    } catch (error) {
      setProjectError(errorMessage(error))
      return null
    }
  }, [entryId])

  useEffect(() => {
    void call('latex.toolchain').then(setToolchain, () => setToolchain(null))
    void refreshProject().then((info) => {
      if (!info) return
      setActiveFile(info.entryFile)
      if (info.hasPdf) void call('latex.readPdf', { id: entryId }).then(setPdf, () => undefined)
    })
  }, [entryId, refreshProject])

  useEffect(() => {
    if (!activeFile) return
    let cancelled = false
    call('latex.readFile', { id: entryId, file: activeFile }).then(
      (document) => {
        if (cancelled) return
        fileRef.current = activeFile
        content.current = document.content
        version.current = document.version
        saver.reset()
        setLoaded({ file: activeFile, content: document.content, nonce: Date.now() })
      },
      (error: unknown) => !cancelled && toast(errorMessage(error), 'error')
    )
    return () => {
      cancelled = true
    }
  }, [entryId, activeFile, reloadCount, saver])

  const statusSuffix = useCallback(
    (current: CompileResult | null, busy: boolean): string => {
      if (busy) return 'Compiling…'
      if (!current) return toolchain?.available ? 'Not compiled yet' : 'No TeX compiler'
      const errors = current.issues.filter((issue) => issue.severity === 'error').length
      const warnings = current.issues.length - errors
      const label = { success: 'Build succeeded', failed: 'Build failed', timeout: 'Build timed out', 'no-compiler': 'No TeX compiler', busy: 'Already compiling' }[current.status]
      return `${label}  ·  ${errors} errors, ${warnings} warnings`
    },
    [toolchain]
  )

  const updateStatus = useCallback(() => {
    setStatusText(entryId, `${fileRef.current ?? ''}  ·  Ln ${cursor.current.line}, Col ${cursor.current.column}  ·  ${statusSuffix(result, compiling)}`)
  }, [entryId, setStatusText, statusSuffix, result, compiling])
  useEffect(updateStatus, [updateStatus, loaded])

  const switchFile = async (file: string): Promise<void> => {
    if (file === activeFile) return
    await saver.flush()
    setActiveFile(file)
  }

  const compile = useCallback(async () => {
    if (compiling) return
    setCompiling(true)
    try {
      // Sources are saved before a build starts, so the engine compiles what is on screen.
      await saver.flush()
      const outcome = await call('latex.compile', { id: entryId })
      setResult(outcome)
      if (outcome.pdfUpdated) setPdf(await call('latex.readPdf', { id: entryId }))
      await refreshProject()
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setCompiling(false)
    }
  }, [compiling, entryId, refreshProject, saver])

  const compileRef = useRef(compile)
  compileRef.current = compile

  // F5 compiles while this tab is the visible one, wherever the focus is inside it.
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'F5') {
        event.preventDefault()
        void compileRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const keys = useMemo<KeyBinding[]>(
    () => [
      {
        key: 'Mod-Enter',
        run: () => {
          void compileRef.current()
          return true
        }
      },
      {
        key: 'Mod-Shift-k',
        run: (view) => {
          const { from, to } = view.state.selection.main
          requestFlashcardDrafts(view.state.sliceDoc(from, to), entryId)
          return true
        }
      }
    ],
    [entryId]
  )

  const createFile = async (): Promise<void> => {
    const name = await promptDialog({
      title: 'New file',
      label: 'File name (folders allowed, for example sections/intro.tex)',
      initialValue: 'section.tex',
      confirmLabel: 'Create',
      validate: validateFileName
    })
    if (!name) return
    try {
      await call('latex.createFile', { id: entryId, file: name })
      await refreshProject()
      await switchFile(name)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const deleteFile = async (file: string): Promise<void> => {
    const confirmed = await confirmDialog({
      title: `Delete “${file}”?`,
      body: 'The file will be moved to the Recycle Bin.',
      confirmLabel: 'Move to Recycle Bin',
      danger: true
    })
    if (!confirmed) return
    try {
      if (file === activeFile && project) setActiveFile(project.entryFile)
      await call('latex.deleteFile', { id: entryId, file })
      await refreshProject()
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const jumpTo = async (file: string | null, line: number | null): Promise<void> => {
    if (file && project?.files.some((candidate) => candidate.relPath === file && candidate.editable)) await switchFile(file)
    if (line === null) return
    // Wait a moment for the file to load when it was just switched.
    setTimeout(() => {
      const view = viewRef.current
      if (!view || line > view.state.doc.lines) return
      const target = view.state.doc.line(line)
      view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true })
      view.focus()
    }, 150)
  }

  if (projectError) {
    return <EmptyState icon={<CircleAlert size={18} />} title="This project could not be opened" body={projectError} />
  }
  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const errors = result?.issues.filter((issue) => issue.severity === 'error').length ?? 0
  const warnings = (result?.issues.length ?? 0) - errors

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="toolbar" aria-label="LaTeX" className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <Button variant="primary" size="sm" disabled={compiling || toolchain?.available === false} onClick={() => void compile()} title="Ctrl+Enter or F5">
          {compiling ? <Spinner size={12} className="text-accent-fg" /> : <Play size={12} fill="currentColor" />}
          {compiling ? 'Compiling…' : 'Compile'}
        </Button>
        {result && !compiling && (
          <span
            data-testid="compile-status"
            className={cn(
              'flex items-center gap-1.5 text-xs',
              result.status === 'success' ? 'text-success' : result.status === 'failed' || result.status === 'timeout' ? 'text-danger' : 'text-muted'
            )}
          >
            {result.status === 'success' ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
            {statusSuffix(result, false).split('  ·  ')[0]}
            {result.passes > 0 && (
              <span className="text-subtle">
                · {result.passes} {result.passes === 1 ? 'pass' : 'passes'}, {(result.durationMs / 1000).toFixed(1)} s
              </span>
            )}
          </span>
        )}
        <span className="flex-1" />
        <span className="min-w-0 truncate text-xs text-subtle" title={toolchain?.enginePath ?? undefined}>
          {toolchain === null ? '' : toolchain.available ? `pdfLaTeX · ${toolchain.distribution}` : 'No TeX compiler installed'}
        </span>
        <IconButton label={filesShown ? 'Hide project files' : 'Show project files'} active={filesShown} onClick={() => setFilesChoice(!filesShown)}>
          <FolderTree size={15} />
        </IconButton>
        <IconButton
          label="Create flashcards from selection"
          shortcut="Ctrl+Shift+K"
          onClick={() => {
            const view = viewRef.current
            if (!view) return
            const { from, to } = view.state.selection.main
            requestFlashcardDrafts(view.state.sliceDoc(from, to), entryId)
          }}
        >
          <Layers size={15} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={cn('w-[190px] shrink-0 flex-col border-r border-line bg-sidebar', filesShown ? 'flex' : 'hidden')}>
          <div className="flex h-8 items-center justify-between pr-1 pl-3">
            <span className="text-[10.5px] font-semibold tracking-wider text-subtle uppercase">Project files</span>
            <IconButton label="New file" className="h-6 w-6" onClick={() => void createFile()}>
              <FilePlus2 size={13} />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" role="list" aria-label="Project files">
            {project.files.map((file) => {
              const depth = file.relPath.split('/').length - 1
              const name = file.relPath.split('/').pop()!
              const selected = file.relPath === activeFile
              return (
                <div
                  key={file.relPath}
                  role="listitem"
                  style={{ paddingLeft: 8 + depth * 12 }}
                  className={cn(
                    'group flex h-7 items-center gap-2 rounded-md pr-1 text-xs',
                    file.isDirectory ? 'text-subtle' : file.editable ? 'cursor-default text-muted hover:bg-hover hover:text-fg' : 'text-subtle',
                    selected && 'bg-active text-fg'
                  )}
                  onClick={() => file.editable && void switchFile(file.relPath)}
                  title={file.editable || file.isDirectory ? file.relPath : `${file.relPath} — not editable here`}
                >
                  {file.isDirectory ? <Folder size={13} /> : <FileCode2 size={13} className={file.editable ? 'text-[#d98a4b]' : undefined} />}
                  <span className="flex-1 truncate">{name}</span>
                  {file.relPath === project.entryFile && <span className="text-[10px] text-subtle">main</span>}
                  {!file.isDirectory && file.relPath !== project.entryFile && (
                    <button
                      type="button"
                      aria-label={`Delete ${file.relPath}`}
                      className="hidden h-5 w-5 items-center justify-center rounded text-subtle group-hover:flex hover:bg-active hover:text-danger"
                      onClick={(event) => {
                        event.stopPropagation()
                        void deleteFile(file.relPath)
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <SaveProblemBanner
            state={saveState}
            onReload={() => setReloadCount((count) => count + 1)}
            onOverwrite={() => void saver.overwrite()}
            onRetry={() => void saver.flush()}
          />
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1" data-testid="latex-source">
              {loaded ? (
                <CodeEditor
                  key={loaded.nonce}
                  mode="latex"
                  initialDoc={loaded.content}
                  keys={keys}
                  onChange={(doc) => {
                    content.current = doc
                    saver.markDirty()
                  }}
                  onCursor={(line, column) => {
                    cursor.current = { line, column }
                    updateStatus()
                  }}
                  onReady={(view) => {
                    viewRef.current = view
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Spinner />
                </div>
              )}
            </div>
            <div className={cn('w-[44%] shrink-0 border-l border-line', narrow ? 'min-w-[200px]' : 'min-w-[280px]')}>
              {pdf && !compiling ? <PdfPreview data={pdf} /> : <div className="h-full bg-canvas"><PreviewPlaceholder toolchain={toolchain} compiling={compiling} /></div>}
            </div>
          </div>

          <div className="flex h-[150px] max-h-[35%] shrink-0 flex-col border-t border-line" aria-label="Compilation output">
            <div className="flex h-7 shrink-0 items-center gap-3 border-b border-line bg-sidebar px-3 text-[11px] text-muted">
              <TerminalSquare size={12} />
              <span className="font-medium">Compilation</span>
              {result && result.passes > 0 && (
                <span>
                  {errors} {errors === 1 ? 'error' : 'errors'}, {warnings} {warnings === 1 ? 'warning' : 'warnings'}
                </span>
              )}
              <span className="flex-1" />
              {result && result.log && (
                <button type="button" className="hover:text-fg" onClick={() => setShowRawLog(!showRawLog)}>
                  {showRawLog ? 'Show problems' : 'Show raw log'}
                </button>
              )}
            </div>
            <div className="selectable min-h-0 flex-1 overflow-auto px-3 py-1.5 font-mono text-[11.5px] leading-relaxed">
              {!result ? (
                <p className="text-subtle">
                  {toolchain?.available === false
                    ? 'No TeX compiler was found on this computer, so nothing can be compiled yet.'
                    : 'Compilation results will appear here.'}
                </p>
              ) : result.status === 'no-compiler' ? (
                <p className="text-warning">No TeX compiler was found on this computer. Nothing was compiled.</p>
              ) : showRawLog ? (
                <pre className="whitespace-pre-wrap text-muted">{result.log}</pre>
              ) : result.issues.length === 0 ? (
                <p className={result.status === 'success' ? 'text-success' : 'text-muted'}>
                  {result.status === 'success' ? 'Compiled without errors or warnings.' : 'No problems were found in the log.'}
                </p>
              ) : (
                result.issues.map((issue, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => void jumpTo(issue.file, issue.line)}
                    className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-hover"
                  >
                    {issue.severity === 'error' ? (
                      <CircleAlert size={12} className="mt-0.5 shrink-0 text-danger" />
                    ) : (
                      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warning" />
                    )}
                    {(issue.file || issue.line !== null) && (
                      <span className="shrink-0 text-subtle">
                        {issue.file ?? ''}
                        {issue.line !== null ? `:${issue.line}` : ''}
                      </span>
                    )}
                    <span className="text-fg">{issue.message}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
