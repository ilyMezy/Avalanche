import { Command } from 'cmdk'
import { CalendarCheck, FilePlus2, Files, FolderPlus, Home, Layers, Moon, Search, Settings, StickyNote, Sun, Upload } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { displayTitle } from '@shared/domain/naming'
import type { SearchHit } from '@shared/types'
import { EntryIcon, KIND_LABELS } from '@/features/workspace/EntryIcon'
import { call } from '@/lib/api'
import { createFolderIn, createQuickNote, importFilesInto, openEntry, showNewDialog, updateSettings } from './actions'
import { useAppStore, type Section } from './store'

interface PaletteCommand {
  id: string
  label: string
  icon: ReactNode
  shortcut?: string
  run(): void
}

function useCommands(): PaletteCommand[] {
  const dark = useAppStore((state) => state.settings?.theme !== 'glacier')
  const go = (section: Section) => () => useAppStore.getState().setSection(section)
  return [
    { id: 'new-doc', label: 'New document…', icon: <FilePlus2 size={15} />, shortcut: 'Ctrl+N', run: () => showNewDialog() },
    { id: 'new-docx', label: 'New Document (DOCX)', icon: <FilePlus2 size={15} />, run: () => showNewDialog(undefined, 'docx') },
    { id: 'new-md', label: 'New Markdown Note', icon: <FilePlus2 size={15} />, run: () => showNewDialog(undefined, 'markdown') },
    { id: 'new-tex', label: 'New LaTeX Project', icon: <FilePlus2 size={15} />, run: () => showNewDialog(undefined, 'latex_project') },
    { id: 'new-slides', label: 'New Slides (PPTX)', icon: <FilePlus2 size={15} />, run: () => showNewDialog(undefined, 'slides') },
    { id: 'add-files', label: 'Add files to the workspace… (.pptx, .pdf, .docx, .md)', icon: <Upload size={15} />, run: () => void importFilesInto(useAppStore.getState().folder) },
    { id: 'new-note', label: 'New quick note', icon: <StickyNote size={15} />, run: () => void createQuickNote() },
    { id: 'new-folder', label: 'New folder…', icon: <FolderPlus size={15} />, shortcut: 'Ctrl+Shift+N', run: () => void createFolderIn(useAppStore.getState().folder) },
    { id: 'go-home', label: 'Go to Home', icon: <Home size={15} />, run: go('home') },
    { id: 'go-documents', label: 'Go to Documents', icon: <Files size={15} />, run: go('documents') },
    { id: 'go-notes', label: 'Go to Quick Notes', icon: <StickyNote size={15} />, run: go('notes') },
    { id: 'go-flashcards', label: 'Go to Flashcards', icon: <Layers size={15} />, run: go('flashcards') },
    { id: 'go-planner', label: 'Go to Planner', icon: <CalendarCheck size={15} />, run: go('planner') },
    { id: 'go-settings', label: 'Open Settings', icon: <Settings size={15} />, shortcut: 'Ctrl+,', run: go('settings') },
    {
      id: 'study',
      label: 'Study due flashcards',
      icon: <Layers size={15} />,
      run: () => useAppStore.setState({ section: 'flashcards', activeTabId: null, studyRequest: { deckId: null } })
    },
    {
      id: 'theme',
      label: dark ? 'Switch to the Glacier Light theme' : 'Switch to the Avalanche Night theme',
      icon: dark ? <Sun size={15} /> : <Moon size={15} />,
      run: () => void updateSettings({ theme: dark ? 'glacier' : 'avalanche' })
    }
  ]
}

const ITEM =
  'flex h-9 cursor-default items-center gap-3 rounded-md px-2.5 text-[13px] text-fg data-[selected=true]:bg-hover [&_svg]:shrink-0'
const GROUP =
  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle [&_[cmdk-group-heading]]:uppercase'

/** Global search and command palette (Ctrl+K). Searches file names and document content. */
export function CommandPalette(): ReactNode {
  const open = useAppStore((state) => state.paletteOpen)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const commands = useCommands()
  const close = (): void => useAppStore.setState({ paletteOpen: false })

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      call('workspace.search', { query: trimmed }).then(
        (result) => !cancelled && setHits(result.slice(0, 12)),
        () => !cancelled && setHits([])
      )
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const needle = query.trim().toLowerCase()
  const matching = needle ? commands.filter((command) => command.label.toLowerCase().includes(needle)) : commands
  const run = (action: () => void): void => {
    close()
    action()
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(value) => useAppStore.setState({ paletteOpen: value })}
      label="Search and commands"
      shouldFilter={false}
      loop
      overlayClassName="animate-fade fixed inset-0 z-50 bg-black/45"
      contentClassName="animate-pop fixed top-[12%] left-1/2 z-50 w-[600px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-pop focus:outline-none"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-3.5">
        <Search size={15} className="text-subtle" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search files by name or content, or type a command…"
          className="h-11 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
        />
      </div>
      <Command.List className="max-h-[380px] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted">Nothing matches “{query}”.</Command.Empty>
        {hits.length > 0 && (
          <Command.Group heading="Files" className={GROUP}>
            {hits.map((hit) => (
              <Command.Item key={hit.entry.id} value={`file-${hit.entry.id}`} onSelect={() => run(() => void openEntry(hit.entry))} className={ITEM}>
                <EntryIcon kind={hit.entry.kind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{displayTitle(hit.entry.name, hit.entry.kind)}</span>
                  {hit.snippet && <span className="block truncate text-xs text-subtle">{hit.snippet}</span>}
                </span>
                <span className="max-w-[40%] truncate text-xs text-subtle">{hit.entry.parentPath || KIND_LABELS[hit.entry.kind]}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {matching.length > 0 && (
          <Command.Group heading="Commands" className={GROUP}>
            {matching.map((command) => (
              <Command.Item key={command.id} value={command.id} onSelect={() => run(command.run)} className={ITEM}>
                <span className="text-subtle">{command.icon}</span>
                <span className="flex-1">{command.label}</span>
                {command.shortcut && <span className="text-xs text-subtle">{command.shortcut}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  )
}
