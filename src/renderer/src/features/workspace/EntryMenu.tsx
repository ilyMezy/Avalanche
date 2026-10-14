import { ExternalLink, FilePlus2, FolderInput, FolderOpen, FolderPlus, Pencil, Star, StarOff, Trash2 } from 'lucide-react'
import type { Entry } from '@shared/types'
import { createFolderIn, deleteEntry, openEntry, renameEntry, showNewDialog, toggleFavorite } from '@/app/actions'
import { useAppStore } from '@/app/store'
import type { MenuEntry } from '@/components/ui/overlays'
import { call } from '@/lib/api'

/** The context-menu actions for a file or folder, shared by every place entries are listed. */
export function entryMenuItems(entry: Entry): MenuEntry[] {
  const isFolder = entry.kind === 'folder'
  return [
    { label: 'Open', icon: <FolderOpen size={14} />, onSelect: () => void openEntry(entry) },
    ...(isFolder
      ? ([
          { type: 'separator' },
          { label: 'New document here…', icon: <FilePlus2 size={14} />, onSelect: () => showNewDialog(entry.relPath) },
          { label: 'New folder inside…', icon: <FolderPlus size={14} />, onSelect: () => void createFolderIn(entry.relPath) }
        ] satisfies MenuEntry[])
      : []),
    { type: 'separator' },
    { label: 'Rename…', icon: <Pencil size={14} />, shortcut: 'F2', onSelect: () => void renameEntry(entry) },
    { label: 'Move to…', icon: <FolderInput size={14} />, onSelect: () => useAppStore.setState({ moveEntry: entry }) },
    {
      label: entry.isFavorite ? 'Remove from favorites' : 'Add to favorites',
      icon: entry.isFavorite ? <StarOff size={14} /> : <Star size={14} />,
      onSelect: () => void toggleFavorite(entry)
    },
    {
      label: 'Show in File Explorer',
      icon: <ExternalLink size={14} />,
      onSelect: () => void call('workspace.showInFolder', { id: entry.id }).catch(() => undefined)
    },
    { type: 'separator' },
    { label: 'Delete', icon: <Trash2 size={14} />, shortcut: 'Del', danger: true, onSelect: () => void deleteEntry(entry) }
  ]
}

/** Drag-and-drop payload type used when moving entries between folders. */
export const ENTRY_DRAG_TYPE = 'application/x-offline-workspace-entry'
