import { Command } from 'cmdk'
import { CornerDownLeft, Search } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { displayTitle } from '@shared/domain/naming'
import type { Entry } from '@shared/types'
import { Kbd } from '@/components/ui/feedback'
import { EntryIcon, KIND_LABELS } from '@/features/workspace/EntryIcon'
import { call } from '@/lib/api'
import { openEntry } from './actions'
import { useAppStore } from './store'

/**
 * Quick Open (Ctrl+P): jump to a document or folder by title. Matching is local and fuzzy;
 * exact titles come first, then the most recently opened. With nothing typed it lists what was
 * opened last. Enter opens a document or navigates to a folder; Escape closes.
 */
export function QuickOpen(): ReactNode {
  const open = useAppStore((state) => state.quickOpen)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Entry[]>([])
  // Results arrive asynchronously, so the highlighted row is controlled here: whenever the
  // list changes, the best match is highlighted and Enter opens it.
  const [selected, setSelected] = useState('')
  useEffect(() => setSelected(results[0]?.id ?? ''), [results])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    let cancelled = false
    const timer = setTimeout(
      () => {
        call('workspace.quickOpen', { query }).then(
          (entries) => !cancelled && setResults(entries),
          () => !cancelled && setResults([])
        )
      },
      query ? 50 : 0
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query])

  const choose = (entry: Entry): void => {
    useAppStore.setState({ quickOpen: false })
    void openEntry(entry)
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(value) => useAppStore.setState({ quickOpen: value })}
      label="Quick Open"
      value={selected}
      onValueChange={setSelected}
      shouldFilter={false}
      loop
      overlayClassName="ui-overlay fixed inset-0 z-50 bg-black/50"
      contentClassName="ui-dialog fixed top-[12%] left-1/2 z-50 w-[580px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-xl border border-line-strong bg-raised shadow-pop outline-none"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-3.5">
        <Search size={15} className="text-subtle" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Open a document or folder by name…"
          className="h-11 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
        />
      </div>
      <Command.List className="max-h-[360px] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted">
          {query ? `No document or folder matches “${query}”.` : 'Documents you open will be listed here.'}
        </Command.Empty>
        {results.map((entry) => (
          <Command.Item
            key={entry.id}
            value={entry.id}
            onSelect={() => choose(entry)}
            data-testid="quick-open-item"
            className="flex h-9 cursor-default items-center gap-3 rounded-md px-2.5 text-[13px] text-fg data-[selected=true]:bg-hover"
          >
            <EntryIcon kind={entry.kind} />
            <span className="min-w-0 flex-1 truncate">{displayTitle(entry.name, entry.kind)}</span>
            <span className="max-w-[45%] truncate text-xs text-subtle">{entry.parentPath || KIND_LABELS[entry.kind]}</span>
          </Command.Item>
        ))}
      </Command.List>
      <div className="flex h-8 items-center gap-3 border-t border-line px-3.5 text-[11px] text-subtle">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to move
        </span>
        <span className="flex items-center gap-1">
          <CornerDownLeft size={11} /> to open
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Esc</Kbd> to close
        </span>
      </div>
    </Command.Dialog>
  )
}
