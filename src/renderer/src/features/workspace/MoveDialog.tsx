import { HardDrive } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { displayTitle } from '@shared/domain/naming'
import type { FolderNode } from '@shared/types'
import { moveEntryTo } from '@/app/actions'
import { useAppStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/overlays'
import { call } from '@/lib/api'
import { useData } from '@/lib/useData'
import { cn } from '@/lib/utils'
import { FolderTree } from './FolderTree'

/** A folder picker: the workspace root plus the full folder tree. */
export function FolderPicker({
  value,
  onChange,
  disabledPath,
  className
}: {
  value: string
  onChange(path: string): void
  disabledPath?: string
  className?: string
}): ReactNode {
  const tree = useData<FolderNode[]>(['workspace'], () => call('workspace.tree'))
  return (
    <div role="tree" aria-label="Folders" className={cn('overflow-y-auto rounded-md border border-line bg-bg p-1', className)}>
      <div
        role="treeitem"
        aria-selected={value === ''}
        tabIndex={0}
        onClick={() => onChange('')}
        onKeyDown={(event) => event.key === 'Enter' && onChange('')}
        className={cn(
          'flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg',
          value === '' && 'bg-active text-fg'
        )}
      >
        <HardDrive size={14} className="text-subtle" />
        Workspace
      </div>
      <FolderTree nodes={tree.data ?? []} selectedPath={value} onSelect={(node) => onChange(node.relPath)} disabledPath={disabledPath} depth={1} />
    </div>
  )
}

/** The keyboard-accessible alternative to drag-and-drop for moving items (spec WS-12). */
export function MoveDialog(): ReactNode {
  const entry = useAppStore((state) => state.moveEntry)
  const [target, setTarget] = useState('')
  useEffect(() => {
    if (entry) setTarget(entry.parentPath)
  }, [entry])
  if (!entry) return null
  const close = (): void => useAppStore.setState({ moveEntry: null })
  return (
    <Modal
      open
      onOpenChange={(open) => !open && close()}
      title={`Move “${displayTitle(entry.name, entry.kind)}”`}
      description="Choose the destination folder."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={target === entry.parentPath}
            onClick={() => {
              close()
              void moveEntryTo(entry, target)
            }}
          >
            Move here
          </Button>
        </>
      }
    >
      <FolderPicker value={target} onChange={setTarget} disabledPath={entry.kind === 'folder' ? entry.relPath : undefined} className="h-64" />
    </Modal>
  )
}
