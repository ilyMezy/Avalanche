import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, FilePlus2, FolderOpen, FolderPlus, MoreHorizontal, Search, SearchX, Star, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { displayTitle } from '@shared/domain/naming'
import type { Entry, SearchHit } from '@shared/types'
import { createFolderIn, deleteEntry, importFilesInto, openEntry, renameEntry, showNewDialog, toggleFavorite } from '@/app/actions'
import { useAppStore } from '@/app/store'
import { Button, IconButton } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/controls'
import { EmptyState, Spinner } from '@/components/ui/feedback'
import { ActionMenu, ContextArea } from '@/components/ui/overlays'
import { EntryIcon, KIND_LABELS } from '@/features/workspace/EntryIcon'
import { ENTRY_DRAG_TYPE, entryMenuItems } from '@/features/workspace/EntryMenu'
import { useEntryDrop } from '@/features/workspace/FolderTree'
import { call } from '@/lib/api'
import { useData } from '@/lib/useData'
import { cn, formatTimestamp } from '@/lib/utils'

type SortKey = 'name' | 'modified' | 'kind'

function sortEntries(entries: Entry[], key: SortKey, ascending: boolean): Entry[] {
  const direction = ascending ? 1 : -1
  return [...entries].sort((a, b) => {
    // Folders always come first, whatever the sort order.
    const folders = Number(b.kind === 'folder') - Number(a.kind === 'folder')
    if (folders !== 0) return folders
    if (key === 'modified') return (a.modifiedAt - b.modifiedAt) * direction
    if (key === 'kind') return (KIND_LABELS[a.kind].localeCompare(KIND_LABELS[b.kind]) || a.name.localeCompare(b.name)) * direction
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) * direction
  })
}

function Row({
  entry,
  selected,
  subtitle,
  onSelect
}: {
  entry: Entry
  selected: boolean
  subtitle?: string | null
  onSelect(): void
}): ReactNode {
  const drop = useEntryDrop(entry.relPath)
  const isFolder = entry.kind === 'folder'
  const menu = entryMenuItems(entry)
  return (
    <ContextArea items={menu}>
      <div
        role="row"
        aria-selected={selected}
        tabIndex={0}
        draggable
        data-testid="entry-row"
        data-name={entry.name}
        onDragStart={(event) => {
          event.dataTransfer.setData(ENTRY_DRAG_TYPE, JSON.stringify(entry))
          event.dataTransfer.effectAllowed = 'move'
        }}
        {...(isFolder ? drop.handlers : {})}
        onClick={onSelect}
        onFocus={onSelect}
        onDoubleClick={() => void openEntry(entry)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter') void openEntry(entry)
          if (event.key === 'F2') void renameEntry(entry)
          if (event.key === 'Delete') void deleteEntry(entry)
        }}
        className={cn(
          'group grid h-9 cursor-default grid-cols-[minmax(0,1fr)_130px_150px_64px] items-center gap-3 rounded-md px-3 text-[13px] transition-colors duration-75',
          selected ? 'bg-active' : 'hover:bg-hover',
          isFolder && drop.over && 'bg-accent-soft ring-1 ring-accent'
        )}
      >
        <div role="gridcell" className="flex min-w-0 items-center gap-2.5">
          <EntryIcon kind={entry.kind} />
          <span className="truncate text-fg">{displayTitle(entry.name, entry.kind)}</span>
          {subtitle && <span className="truncate text-xs text-subtle">{subtitle}</span>}
        </div>
        <div role="gridcell" className="truncate text-xs text-muted">
          {KIND_LABELS[entry.kind]}
        </div>
        <div role="gridcell" className="truncate text-xs text-muted">
          {formatTimestamp(entry.modifiedAt)}
        </div>
        <div role="gridcell" className="flex items-center justify-end gap-0.5">
          <IconButton
            label={entry.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            className={cn('h-6 w-6', !entry.isFavorite && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
            onClick={(event) => {
              event.stopPropagation()
              void toggleFavorite(entry)
            }}
          >
            <Star size={13} className={entry.isFavorite ? 'fill-current text-warning' : undefined} />
          </IconButton>
          <ActionMenu items={menu} align="end">
            <IconButton label="More actions" className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
              <MoreHorizontal size={14} />
            </IconButton>
          </ActionMenu>
        </div>
      </div>
    </ContextArea>
  )
}

/** The folder-based file manager: list view of one folder, with search across the workspace. */
export function DocumentsView(): ReactNode {
  const folder = useAppStore((state) => state.folder)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [ascending, setAscending] = useState(true)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const listing = useData<Entry[]>(['workspace'], () => call('workspace.list', { parentPath: folder }), [folder])
  const sorted = useMemo(() => sortEntries(listing.data ?? [], sortKey, ascending), [listing.data, sortKey, ascending])

  useEffect(() => {
    setQuery('')
    setSelectedId(null)
  }, [folder])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setHits(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      call('workspace.search', { query: trimmed }).then(
        (result) => !cancelled && setHits(result),
        () => !cancelled && setHits([])
      )
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, listing.data])

  // Alt+Left goes up a folder, as in File Explorer, wherever focus is while this view is showing.
  useEffect(() => {
    if (!folder) return
    const onKey = (event: KeyboardEvent): void => {
      if (!event.altKey || event.key !== 'ArrowLeft' || document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      useAppStore.getState().setFolder(folder.split('/').slice(0, -1).join('/'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [folder])

  const folderName = folder ? folder.split('/').pop() : 'Documents'
  // The way back out of a folder: its parent, and every folder on the path down to it.
  const segments = folder ? folder.split('/') : []
  const parentPath = segments.slice(0, -1).join('/')
  const parentName = segments.length > 1 ? segments[segments.length - 2] : 'Documents'
  const goUp = (): void => useAppStore.getState().setFolder(parentPath)
  const searching = query.trim().length > 0

  return (
    <div className="flex h-full flex-col">
      {folder && (
        <nav aria-label="Folder path" className="flex shrink-0 items-center gap-2 px-6 pt-4">
          <Button className="h-9 px-3 text-[13px]" onClick={goUp} title="Go up one folder (Alt+Left)">
            <ArrowLeft size={15} />
            Back to {parentName}
          </Button>
          <div className="flex min-w-0 items-center gap-0.5 text-[13px] text-muted">
            <button type="button" className="rounded-md px-1.5 py-1 hover:bg-hover hover:text-fg" onClick={() => useAppStore.getState().setFolder('')}>
              Documents
            </button>
            {segments.map((segment, index) => {
              const target = segments.slice(0, index + 1).join('/')
              const last = index === segments.length - 1
              return (
                <span key={target} className="flex min-w-0 items-center gap-0.5">
                  <ChevronRight size={13} className="shrink-0 text-subtle" />
                  {last ? (
                    <span className="truncate px-1.5 py-1 font-medium text-fg" aria-current="page">
                      {segment}
                    </span>
                  ) : (
                    <button type="button" className="truncate rounded-md px-1.5 py-1 hover:bg-hover hover:text-fg" onClick={() => useAppStore.getState().setFolder(target)}>
                      {segment}
                    </button>
                  )}
                </span>
              )
            })}
          </div>
        </nav>
      )}
      <div className={cn('flex shrink-0 flex-wrap items-center gap-2 px-6 pb-3', folder ? 'pt-3' : 'pt-5')}>
        <h1 className="order-1 mr-auto min-w-0 truncate text-[22px] font-semibold tracking-tight">{folderName}</h1>
        <span className="order-3 basis-full" aria-hidden />
        <div className="relative order-4 min-w-[180px] max-w-[360px] flex-1">
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
          <Input
            aria-label="Search the workspace"
            placeholder="Search names and content"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setQuery('')}
            className="pl-8"
          />
        </div>
        <IconButton label="Trash: restore deleted items" className="order-4 h-8 w-8 border border-line-strong" onClick={() => useAppStore.setState({ trashOpen: true })}>
          <Trash2 size={14} />
        </IconButton>
        <Select aria-label="Sort by" className="order-4 w-[160px]" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
          <option value="name">Sort by name</option>
          <option value="modified">Sort by modified</option>
          <option value="kind">Sort by type</option>
        </Select>
        <IconButton label={ascending ? 'Ascending — click for descending' : 'Descending — click for ascending'} className="order-4 h-8 w-8 border border-line-strong" onClick={() => setAscending(!ascending)}>
          {ascending ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
        </IconButton>
        <Button className="order-2" onClick={() => void importFilesInto(folder)} title="Copy .pptx, .pdf, .docx, or .md files into this folder">
          <Upload size={14} />
          Add files
        </Button>
        <Button className="order-2" onClick={() => void createFolderIn(folder)}>
          <FolderPlus size={14} />
          New folder
        </Button>
        <Button className="order-2" variant="primary" onClick={() => showNewDialog(folder)}>
          <FilePlus2 size={14} />
          New
        </Button>
      </div>

      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_130px_150px_64px] gap-3 border-b border-line px-9 pb-1.5 text-[11px] font-medium tracking-wide text-subtle uppercase">
        <span>Name</span>
        <span>Type</span>
        <span>Modified</span>
        <span />
      </div>

      <div role="grid" aria-label={searching ? 'Search results' : `Contents of ${folderName}`} className="min-h-0 flex-1 overflow-y-auto px-6 py-2">
        {searching ? (
          hits === null ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : hits.length === 0 ? (
            <EmptyState icon={<SearchX size={18} />} title={`No results for “${query.trim()}”`} body="Search looks at file and folder names and at the text of your documents." />
          ) : (
            hits.map((hit) => (
              <Row
                key={hit.entry.id}
                entry={hit.entry}
                selected={hit.entry.id === selectedId}
                subtitle={hit.snippet ?? (hit.entry.parentPath ? `in ${hit.entry.parentPath}` : null)}
                onSelect={() => setSelectedId(hit.entry.id)}
              />
            ))
          )
        ) : listing.error ? (
          <EmptyState icon={<FolderOpen size={18} />} title="This folder could not be opened" body={listing.error}>
            <Button onClick={() => useAppStore.getState().setFolder('')}>Go to the workspace root</Button>
          </EmptyState>
        ) : listing.data === undefined ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<FolderOpen size={18} />}
            title="This folder is empty"
            body="Create a document, a LaTeX project, or a Markdown note here, or add a subfolder to organize your work."
          >
            <Button variant="primary" onClick={() => showNewDialog(folder)}>
              <FilePlus2 size={14} />
              New document
            </Button>
            <Button onClick={() => void createFolderIn(folder)}>
              <FolderPlus size={14} />
              New folder
            </Button>
          </EmptyState>
        ) : (
          sorted.map((entry) => <Row key={entry.id} entry={entry} selected={entry.id === selectedId} onSelect={() => setSelectedId(entry.id)} />)
        )}
      </div>
    </div>
  )
}
