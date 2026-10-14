import { FolderInput, Pin, PinOff, Plus, Search, StickyNote, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { displayTitle, validateName } from '@shared/domain/naming'
import type { QuickNote } from '@shared/types'
import { createQuickNote, deleteEntry } from '@/app/actions'
import { useAppStore } from '@/app/store'
import { Button, IconButton } from '@/components/ui/button'
import { Input } from '@/components/ui/controls'
import { EmptyState, SaveBadge, toast } from '@/components/ui/feedback'
import { MarkdownEditor } from '@/features/editor-markdown/MarkdownEditor'
import { call, errorMessage } from '@/lib/api'
import { invalidate, useData } from '@/lib/useData'
import { flushOne } from '@/lib/useSaver'
import { cn, formatTimestamp } from '@/lib/utils'

function NoteHeader({ note }: { note: QuickNote }): ReactNode {
  const saveState = useAppStore((state) => state.saveStates[note.id])
  const title = displayTitle(note.name, note.kind)
  const [draft, setDraft] = useState(title)
  useEffect(() => setDraft(title), [title])

  const commit = async (): Promise<void> => {
    const next = draft.trim()
    if (!next || next === title) {
      setDraft(title)
      return
    }
    const problem = validateName(next)
    if (problem) {
      toast(problem, 'error')
      setDraft(title)
      return
    }
    try {
      await flushOne(note.id)
      await call('workspace.rename', { id: note.id, name: next })
      invalidate('workspace')
    } catch (error) {
      toast(errorMessage(error), 'error')
      setDraft(title)
    }
  }

  const togglePin = async (): Promise<void> => {
    await call('workspace.setPinned', { id: note.id, value: !note.isPinned }).catch((error) => toast(errorMessage(error), 'error'))
    invalidate('workspace')
  }

  return (
    <div className="shrink-0 border-b border-line px-5 pt-4 pb-2.5">
      <div className="flex items-center gap-2">
        <input
          aria-label="Note title"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setDraft(title)
              event.currentTarget.blur()
            }
          }}
          className="min-w-0 flex-1 rounded bg-transparent text-lg font-semibold tracking-tight text-fg outline-none placeholder:text-subtle"
          placeholder="Untitled note"
        />
        <SaveBadge state={saveState} />
        <IconButton label={note.isPinned ? 'Unpin note' : 'Pin note'} active={note.isPinned} onClick={() => void togglePin()}>
          {note.isPinned ? <PinOff size={15} /> : <Pin size={15} />}
        </IconButton>
        <IconButton label="Move to folder…" onClick={() => useAppStore.setState({ moveEntry: note })}>
          <FolderInput size={15} />
        </IconButton>
        <IconButton label="Delete note" onClick={() => void deleteEntry(note)}>
          <Trash2 size={15} />
        </IconButton>
      </div>
      <div className="mt-1 flex gap-4 text-[11px] text-subtle">
        <span>Created {formatTimestamp(note.createdAt)}</span>
        <span>Modified {formatTimestamp(note.modifiedAt)}</span>
        <span className="truncate">In {note.parentPath}</span>
      </div>
    </div>
  )
}

/** Quick Notes: a lightweight list-and-editor view over the Markdown files in one folder. */
export function QuickNotesView(): ReactNode {
  const selectedId = useAppStore((state) => state.selectedNoteId)
  const [filter, setFilter] = useState('')
  const notes = useData<QuickNote[]>(['workspace'], () => call('notes.list'))

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const all = notes.data ?? []
    return needle ? all.filter((note) => note.name.toLowerCase().includes(needle) || note.preview.toLowerCase().includes(needle)) : all
  }, [notes.data, filter])

  const selected = notes.data?.find((note) => note.id === selectedId) ?? null

  // Keep a note selected when there is one, so the editor is ready immediately.
  useEffect(() => {
    if (notes.data && !selected && notes.data.length > 0) useAppStore.setState({ selectedNoteId: notes.data[0].id })
  }, [notes.data, selected])

  const select = (id: string): void => {
    useAppStore.setState({ selectedNoteId: id })
    void call('workspace.markOpened', { id }).catch(() => undefined)
  }

  return (
    <div className="flex h-full">
      <div className="flex w-[290px] shrink-0 flex-col border-r border-line">
        <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
          <div className="relative flex-1">
            <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
            <Input aria-label="Search notes" placeholder="Search notes" value={filter} onChange={(event) => setFilter(event.target.value)} className="pl-8" />
          </div>
          <IconButton label="New note" className="h-8 w-8 bg-accent text-accent-fg hover:bg-accent-hover hover:text-accent-fg" onClick={() => void createQuickNote()}>
            <Plus size={16} strokeWidth={2.4} />
          </IconButton>
        </div>
        <div role="listbox" aria-label="Notes" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {visible.map((note) => (
            <button
              key={note.id}
              type="button"
              role="option"
              aria-selected={note.id === selectedId}
              onClick={() => select(note.id)}
              data-testid="note-item"
              className={cn(
                'mb-px block w-full rounded-md px-2.5 py-2 text-left transition-colors duration-75',
                note.id === selectedId ? 'bg-active' : 'hover:bg-hover'
              )}
            >
              <span className="flex items-center gap-1.5">
                {note.isPinned && <Pin size={11} className="shrink-0 fill-current text-accent-text" />}
                <span className="flex-1 truncate text-[13px] font-medium text-fg">{displayTitle(note.name, note.kind)}</span>
                <span className="shrink-0 text-[11px] text-subtle">{formatTimestamp(note.modifiedAt)}</span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted">{note.preview || 'Empty note'}</span>
            </button>
          ))}
          {notes.data && visible.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-subtle">{filter ? 'No notes match your search.' : 'No notes yet.'}</p>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <NoteHeader note={selected} />
            <div className="min-h-0 flex-1">
              <MarkdownEditor key={selected.id} entryId={selected.id} compact />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<StickyNote size={18} />}
            title="No notes yet"
            body="Quick notes are plain Markdown files saved automatically in your workspace's Quick Notes folder. Capture a thought in one click."
          >
            <Button variant="primary" onClick={() => void createQuickNote()}>
              <Plus size={14} />
              New note
            </Button>
          </EmptyState>
        )}
      </div>
    </div>
  )
}
