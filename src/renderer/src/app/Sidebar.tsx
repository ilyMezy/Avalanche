import { CalendarCheck, Files, FolderPlus, Layers, MountainSnow, Pin, PinOff, Plus, RefreshCw, Settings as SettingsIcon, Star, StickyNote, Timer, TriangleAlert, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import { displayTitle, parentOf } from '@shared/domain/naming'
import { DEFAULT_UI_SCALE, macWindowButtons } from '@shared/themes'
import type { Entry, FolderNode, FrequentDoc } from '@shared/types'
import { Logo, Ridges } from '@/components/Logo'
import { IconButton } from '@/components/ui/button'
import { EASE_OUT, toast } from '@/components/ui/feedback'
import { ContextArea, Tip, type MenuEntry } from '@/components/ui/overlays'
import { EntryIcon } from '@/features/workspace/EntryIcon'
import { entryMenuItems } from '@/features/workspace/EntryMenu'
import { FolderTree, useEntryDrop } from '@/features/workspace/FolderTree'
import { call } from '@/lib/api'
import { invalidate, useData } from '@/lib/useData'
import { IS_MAC, keyLabel } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { createFolderIn, openEntry, showNewDialog, updateSettings } from './actions'
import { selectSidebarCollapsed, useAppStore, type Section } from './store'

const RAIL_WIDTH = 52

const NAV: { section: Section; label: string; icon: ReactNode }[] = [
  { section: 'home', label: 'Home', icon: <MountainSnow size={15} /> },
  { section: 'documents', label: 'Documents', icon: <Files size={15} /> },
  { section: 'notes', label: 'Quick Notes', icon: <StickyNote size={15} /> },
  { section: 'flashcards', label: 'Flashcards', icon: <Layers size={15} /> },
  { section: 'planner', label: 'Planner', icon: <CalendarCheck size={15} /> },
  { section: 'focus', label: 'Focus', icon: <Timer size={15} /> }
]

/**
 * Frequent documents: the files opened most, ranked from real open events (recent opens count
 * more). Pinned documents stay at the top. Removing one forgets its history; the file stays.
 */
function FrequentList(): ReactNode {
  const frequent = useData<FrequentDoc[]>(['workspace'], () => call('workspace.frequent'))
  if (!frequent.data?.length) return null

  const change = async (action: Promise<unknown>): Promise<void> => {
    await action.catch((error: unknown) => toast(error instanceof Error ? error.message : 'That did not work.', 'error'))
    invalidate('workspace')
  }
  const menuFor = (doc: FrequentDoc): MenuEntry[] => [
    {
      label: doc.pinned ? 'Unpin from Frequent' : 'Pin to Frequent',
      icon: doc.pinned ? <PinOff size={14} /> : <Pin size={14} />,
      onSelect: () => void change(call('workspace.setFrequentPinned', { id: doc.id, value: !doc.pinned }))
    },
    { label: 'Remove from Frequent', icon: <X size={14} />, onSelect: () => void change(call('workspace.removeFrequent', { id: doc.id })) },
    { type: 'separator' },
    // Open, Reveal, Rename, Move, and Delete are the same actions as everywhere else.
    ...entryMenuItems(doc)
  ]

  return (
    <>
      <SidebarLabel>Frequent</SidebarLabel>
      <div role="list" aria-label="Frequent documents">
        {frequent.data.map((doc) =>
          doc.missing ? (
            <div key={doc.id} role="listitem" data-testid="frequent-item" className="flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-subtle" title={`${doc.relPath} is no longer on disk`}>
              <TriangleAlert size={13} className="shrink-0 text-warning" />
              <span className="flex-1 truncate line-through">{displayTitle(doc.name, doc.kind)}</span>
              <IconButton label="Remove missing document from the list" className="h-5 w-5" onClick={() => void change(call('workspace.removeFrequent', { id: doc.id }))}>
                <X size={12} />
              </IconButton>
            </div>
          ) : (
            <ContextArea key={doc.id} items={menuFor(doc)}>
              <button
                type="button"
                role="listitem"
                data-testid="frequent-item"
                onClick={() => void openEntry(doc)}
                title={doc.relPath}
                className="group flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg"
              >
                <EntryIcon kind={doc.kind} size={14} />
                <span className="min-w-0 flex-1 truncate text-left">{displayTitle(doc.name, doc.kind)}</span>
                {doc.pinned ? (
                  <Pin size={11} className="shrink-0 fill-current text-accent-text" />
                ) : (
                  doc.parentPath && <span className="max-w-[40%] shrink-0 truncate text-[11px] text-subtle opacity-0 group-hover:opacity-100">{doc.parentPath.split('/').pop()}</span>
                )}
              </button>
            </ContextArea>
          )
        )}
      </div>
    </>
  )
}

function NavItem({ section, label, icon, collapsed }: { section: Section; label: string; icon: ReactNode; collapsed: boolean }): ReactNode {
  const active = useAppStore((state) => state.section === section && state.activeTabId === null)
  const setSection = useAppStore((state) => state.setSection)
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={() => setSection(section)}
      className={cn(
        'relative flex h-8 w-full items-center gap-2.5 rounded-md text-[13px]',
        collapsed ? 'justify-center px-0' : 'px-2',
        active ? 'font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg'
      )}
    >
      {/* One shared highlight glides between items instead of each item switching on and off. */}
      {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-md bg-active" transition={{ duration: 0.22, ease: EASE_OUT }} />}
      <span className={cn('relative flex', active ? 'text-accent-text' : 'text-subtle')}>{icon}</span>
      {!collapsed && <span className="relative truncate">{label}</span>}
    </button>
  )
  return collapsed ? (
    <Tip label={label} side="right">
      {button}
    </Tip>
  ) : (
    button
  )
}

function SidebarLabel({ children, actions }: { children: ReactNode; actions?: ReactNode }): ReactNode {
  return (
    <div className="mt-4 mb-0.5 flex h-6 items-center justify-between pr-0.5 pl-2">
      <span className="text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">{children}</span>
      <span className="flex items-center">{actions}</span>
    </div>
  )
}

export function Sidebar(): ReactNode {
  const storedWidth = useAppStore((state) => state.settings?.sidebarWidth ?? 248)
  const collapsed = useAppStore(selectSidebarCollapsed)
  // On macOS the rail is at least as wide as the window buttons that sit at its top.
  const uiScale = useAppStore((state) => state.settings?.uiScale ?? DEFAULT_UI_SCALE)
  const macInset = IS_MAC ? macWindowButtons(uiScale).inset : 0
  const folder = useAppStore((state) => state.folder)
  const inDocuments = useAppStore((state) => state.section === 'documents' && state.activeTabId === null)
  const setFolder = useAppStore((state) => state.setFolder)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [rescanning, setRescanning] = useState(false)
  const widthRef = useRef(storedWidth)
  const rootDrop = useEntryDrop('')

  const tree = useData<FolderNode[]>(['workspace'], () => call('workspace.tree'))
  const favorites = useData<Entry[]>(['workspace'], () => call('workspace.favorites'))
  const favoriteIds = new Set((favorites.data ?? []).map((entry) => entry.id))

  const startResize = (event: React.MouseEvent): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = storedWidth
    const onMove = (move: MouseEvent): void => {
      widthRef.current = Math.min(420, Math.max(200, startWidth + move.clientX - startX))
      setDragWidth(widthRef.current)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      void updateSettings({ sidebarWidth: Math.round(widthRef.current) }).then(() => setDragWidth(null))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const folderAsEntry = (node: FolderNode): Entry => ({
    id: node.id,
    name: node.name,
    relPath: node.relPath,
    parentPath: parentOf(node.relPath),
    kind: 'folder',
    sizeBytes: 0,
    createdAt: 0,
    modifiedAt: 0,
    isFavorite: favoriteIds.has(node.id),
    isPinned: false,
    lastOpenedAt: null
  })

  const rescan = async (): Promise<void> => {
    setRescanning(true)
    await call('workspace.rescan').catch(() => undefined)
    invalidate('workspace')
    setRescanning(false)
  }

  const width = collapsed ? Math.max(RAIL_WIDTH, macInset) : (dragWidth ?? storedWidth)

  return (
    <motion.aside
      aria-label="Sidebar"
      initial={false}
      animate={{ width }}
      // Collapsing and expanding ease; dragging the edge follows the pointer exactly.
      transition={dragWidth === null ? { duration: 0.24, ease: EASE_OUT } : { duration: 0 }}
      className="relative flex shrink-0 flex-col overflow-hidden border-r border-line bg-sidebar"
    >
      {/* Workspace identity. This strip is also part of the window's drag region. */}
      {/* On macOS the window buttons sit in this strip: beside the logo when the sidebar is open,
          and in a row of their own above it on the rail. */}
      {IS_MAC && collapsed && <div className="drag-region h-10 shrink-0" />}
      <div
        className={cn('drag-region flex h-10 shrink-0 items-center gap-2.5', collapsed ? 'justify-center' : 'px-3')}
        style={IS_MAC && !collapsed ? { paddingLeft: macInset } : undefined}
      >
        <Tip label="Home" side="right">
          <button type="button" aria-label="Avalanche: go to Home" onClick={() => useAppStore.getState().setSection('home')} className="no-drag flex shrink-0 rounded-md">
            <Logo size={24} />
          </button>
        </Tip>
        {!collapsed && (
          <div className="min-w-0 leading-[1.15]">
            <div className="truncate text-[14px] font-semibold tracking-tight text-fg">Avalanche</div>
          </div>
        )}
      </div>

      <div className={cn('shrink-0', collapsed ? 'px-2' : 'px-2.5')}>
        {collapsed ? (
          <Tip label="New" shortcut="Ctrl+N" side="right">
            <button
              type="button"
              aria-label="New"
              onClick={() => showNewDialog()}
              className="flex h-8 w-full items-center justify-center rounded-md bg-accent text-accent-fg hover:bg-accent-hover active:scale-[0.97]"
            >
              <Plus size={15} strokeWidth={2.4} />
            </button>
          </Tip>
        ) : (
          <button
            type="button"
            onClick={() => showNewDialog()}
            className="flex h-8 w-full items-center gap-2 rounded-md bg-accent px-2.5 text-[13px] font-medium text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-accent-hover active:scale-[0.985]"
          >
            <Plus size={15} strokeWidth={2.4} />
            <span className="flex-1 text-left">New</span>
            <span className="text-[10.5px] font-normal opacity-70">{keyLabel('Ctrl+N')}</span>
          </button>
        )}
      </div>

      <nav aria-label="Sections" className={cn('mt-2.5 shrink-0 space-y-px', collapsed ? 'px-2' : 'px-2.5')}>
        {NAV.map((item) => (
          <NavItem key={item.section} {...item} collapsed={collapsed} />
        ))}
      </nav>

      <div className={cn('min-h-0 flex-1 overflow-y-auto pb-2', collapsed ? 'px-2' : 'px-2.5')}>
        {!collapsed && (
          <div className="animate-fade">
            <FrequentList />
            {(favorites.data?.length ?? 0) > 0 && (
              <>
                <SidebarLabel>Favorites</SidebarLabel>
                {favorites.data!.map((entry) => (
                  <ContextArea key={entry.id} items={entryMenuItems(entry)}>
                    <button
                      type="button"
                      onClick={() => void openEntry(entry)}
                      title={entry.relPath}
                      className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg"
                    >
                      <EntryIcon kind={entry.kind} size={14} />
                      <span className="flex-1 truncate text-left">{displayTitle(entry.name, entry.kind)}</span>
                      <Star size={11} className="shrink-0 fill-current text-warning" />
                    </button>
                  </ContextArea>
                ))}
              </>
            )}

            <SidebarLabel
              actions={
                <>
                  <IconButton label="New folder" className="h-6 w-6" onClick={() => void createFolderIn('')}>
                    <FolderPlus size={13} />
                  </IconButton>
                  <IconButton label="Rescan workspace folder" className="h-6 w-6" onClick={() => void rescan()}>
                    <RefreshCw size={12} className={rescanning ? 'animate-spin' : undefined} />
                  </IconButton>
                </>
              }
            >
              Folders
            </SidebarLabel>
            <div
              role="tree"
              aria-label="Workspace folders"
              {...rootDrop.handlers}
              className={cn('min-h-10 rounded-md transition-colors duration-150', rootDrop.over && 'bg-accent-soft')}
            >
              <FolderTree
                nodes={tree.data ?? []}
                selectedPath={inDocuments ? folder : null}
                onSelect={(node) => setFolder(node.relPath)}
                menuFor={(node) => entryMenuItems(folderAsEntry(node))}
                droppable
              />
              {tree.data?.length === 0 && <p className="px-2 py-1.5 text-xs leading-relaxed text-subtle">No folders yet. Create one to organize your documents.</p>}
            </div>
          </div>
        )}
      </div>

      {/* A ridgeline closes the sidebar: decorative, drawn from the theme's ridge colours. */}
      {!collapsed && <Ridges className="pointer-events-none -mb-px h-9 w-full shrink-0" />}
      <div className={cn('relative shrink-0 border-t border-line bg-sidebar py-2', collapsed ? 'px-2' : 'px-2.5')}>
        <NavItem section="settings" label="Settings" icon={<SettingsIcon size={15} />} collapsed={collapsed} />
      </div>

      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={startResize}
          className="absolute top-0 right-0 z-10 h-full w-[5px] cursor-col-resize transition-colors duration-150 hover:bg-accent/50"
        />
      )}
    </motion.aside>
  )
}
