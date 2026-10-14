import { ChevronRight } from 'lucide-react'
import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import type { Entry, FolderNode } from '@shared/types'
import { moveEntryTo } from '@/app/actions'
import { ContextArea, type MenuEntry } from '@/components/ui/overlays'
import { cn } from '@/lib/utils'
import { EntryIcon } from './EntryIcon'
import { ENTRY_DRAG_TYPE } from './EntryMenu'

/** Makes an element accept entries dragged from the Documents list and moves them on drop. */
export function useEntryDrop(targetPath: string): {
  over: boolean
  handlers: { onDragOver(event: DragEvent): void; onDragLeave(): void; onDrop(event: DragEvent): void }
} {
  const [over, setOver] = useState(false)
  // A drop handled by a nested target never reaches this element, so the highlight is also
  // cleared whenever any drag ends anywhere in the window.
  useEffect(() => {
    if (!over) return
    const clear = (): void => setOver(false)
    window.addEventListener('dragend', clear, true)
    window.addEventListener('drop', clear, true)
    return () => {
      window.removeEventListener('dragend', clear, true)
      window.removeEventListener('drop', clear, true)
    }
  }, [over])
  return {
    over,
    handlers: {
      onDragOver(event) {
        if (!event.dataTransfer.types.includes(ENTRY_DRAG_TYPE)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop(event) {
        setOver(false)
        const raw = event.dataTransfer.getData(ENTRY_DRAG_TYPE)
        if (!raw) return
        event.preventDefault()
        event.stopPropagation()
        void moveEntryTo(JSON.parse(raw) as Entry, targetPath)
      }
    }
  }
}

interface TreeProps {
  nodes: FolderNode[]
  selectedPath: string | null
  onSelect(node: FolderNode): void
  /** Paths that cannot be chosen (used by the Move dialog to exclude a folder and its children). */
  disabledPath?: string
  menuFor?(node: FolderNode): MenuEntry[]
  droppable?: boolean
  depth?: number
}

function TreeNode({ node, ...props }: Omit<TreeProps, 'nodes'> & { node: FolderNode }): ReactNode {
  const depth = props.depth ?? 0
  const containsSelection = !!props.selectedPath && props.selectedPath.startsWith(node.relPath + '/')
  const [expanded, setExpanded] = useState(containsSelection)
  const drop = useEntryDrop(node.relPath)
  const selected = props.selectedPath === node.relPath
  const disabled = props.disabledPath !== undefined && (node.relPath === props.disabledPath || node.relPath.startsWith(props.disabledPath + '/'))
  const open = expanded || containsSelection

  const row = (
    <div
      role="treeitem"
      aria-expanded={node.children.length > 0 ? open : undefined}
      aria-selected={selected}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && props.onSelect(node)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !disabled) props.onSelect(node)
        if (event.key === 'ArrowRight') setExpanded(true)
        if (event.key === 'ArrowLeft') setExpanded(false)
      }}
      {...(props.droppable ? drop.handlers : {})}
      style={{ paddingLeft: 6 + depth * 14 }}
      className={cn(
        'group flex h-7 cursor-default items-center gap-1.5 rounded-md pr-2 text-[13px] text-muted transition-colors duration-100',
        !disabled && 'hover:bg-hover hover:text-fg',
        selected && 'bg-active text-fg',
        disabled && 'opacity-40',
        drop.over && props.droppable && 'bg-accent-soft text-fg ring-1 ring-accent'
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? 'Collapse' : 'Expand'}
        onClick={(event) => {
          event.stopPropagation()
          setExpanded(!open)
        }}
        className={cn('flex h-4 w-4 items-center justify-center rounded text-subtle hover:text-fg', node.children.length === 0 && 'invisible')}
      >
        <ChevronRight size={13} className={cn('transition-transform duration-100', open && 'rotate-90')} />
      </button>
      <EntryIcon kind="folder" open={open && node.children.length > 0} size={14} />
      <span className="truncate">{node.name}</span>
    </div>
  )

  return (
    <div>
      {props.menuFor ? <ContextArea items={props.menuFor(node)}>{row}</ContextArea> : row}
      {open && node.children.length > 0 && (
        <div role="group">
          <FolderTree {...props} nodes={node.children} depth={depth + 1} />
        </div>
      )}
    </div>
  )
}

/** The hierarchical folder tree, used in the sidebar and in folder pickers. */
export function FolderTree({ nodes, ...props }: TreeProps): ReactNode {
  return (
    <>
      {nodes.map((node) => (
        <TreeNode key={node.id} node={node} {...props} />
      ))}
    </>
  )
}
