import { displayTitle, isOpenable, isSameOrInside, parentOf, validateName } from '@shared/domain/naming'
import type { DocumentKind, Entry, Settings } from '@shared/types'
import { confirmDialog, promptDialog } from '@/components/ui/dialogs'
import { toast } from '@/components/ui/feedback'
import { call, errorMessage } from '@/lib/api'
import { invalidate } from '@/lib/useData'
import { flushOne } from '@/lib/useSaver'
import { plural } from '@/lib/utils'
import { useAppStore, type Tab } from './store'

// User-level actions shared by the sidebar, the Documents view, the command palette, and
// context menus. Components call these instead of talking to the IPC layer directly.

const store = useAppStore

function reportError(error: unknown): void {
  toast(errorMessage(error), 'error')
}

export function isQuickNote(entry: Pick<Entry, 'kind' | 'parentPath'>): boolean {
  const folder = store.getState().settings?.quickNotesFolder ?? 'Quick Notes'
  return entry.kind === 'markdown' && isSameOrInside(entry.parentPath, folder)
}

export async function openEntry(entry: Entry): Promise<void> {
  if (entry.kind === 'folder') {
    store.getState().setFolder(entry.relPath)
    return
  }
  if (!isOpenable(entry.kind)) {
    // Other file types are shown in the workspace but opened outside this app.
    await call('workspace.showInFolder', { id: entry.id }).catch(reportError)
    return
  }
  store.getState().addTab({ id: entry.id, name: entry.name, kind: entry.kind, relPath: entry.relPath })
  await call('workspace.markOpened', { id: entry.id }).catch(() => undefined)
  invalidate('workspace')
}

export async function closeTab(id: string): Promise<void> {
  await flushOne(id)
  const status = store.getState().saveStates[id]?.status
  if (status === 'error' || status === 'conflict') {
    // The document still holds edits that are not on disk; never drop them without asking.
    const discard = await confirmDialog({
      title: 'Close without saving?',
      body: 'This document has changes that could not be saved. If you close it now, those changes will be lost.',
      confirmLabel: 'Close and discard changes',
      danger: true
    })
    if (!discard) return
  }
  store.getState().removeTab(id)
}

/** After a rename, move, or delete, bring open tabs in line with the index. */
export async function syncTabs(): Promise<void> {
  const { tabs, activeTabId } = store.getState()
  const next: Tab[] = []
  for (const tab of tabs) {
    const entry = await call('workspace.get', { id: tab.id }).catch(() => null)
    if (entry) next.push({ id: entry.id, name: entry.name, kind: entry.kind, relPath: entry.relPath })
  }
  // A section view (no active tab) stays in front; only a vanished active tab is replaced.
  const stillActive = activeTabId === null || next.some((tab) => tab.id === activeTabId)
  store.getState().setTabs(next, stillActive ? activeTabId : (next[0]?.id ?? null))
}

export function showNewDialog(parentPath?: string, kind?: DocumentKind): void {
  const state = store.getState()
  const behavior = state.settings?.newDocumentBehavior ?? 'ask'
  // Default destination: the folder of the document being edited, else the folder being browsed.
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId)
  const contextFolder = activeTab ? parentOf(activeTab.relPath) : state.section === 'documents' ? state.folder : ''
  store.setState({
    newDialog: {
      open: true,
      parentPath: parentPath ?? contextFolder,
      kind: kind ?? (behavior === 'ask' ? null : behavior)
    }
  })
}

export async function createFolderIn(parentPath: string): Promise<void> {
  const name = await promptDialog({
    title: 'New folder',
    label: 'Folder name',
    initialValue: 'New folder',
    confirmLabel: 'Create',
    validate: validateName
  })
  if (!name) return
  try {
    await call('workspace.createFolder', { parentPath, name })
    invalidate('workspace')
  } catch (error) {
    reportError(error)
  }
}

/** Copies .pptx, .pdf, .docx, or .md files chosen in a native dialog into a workspace folder. */
export async function importFilesInto(parentPath: string): Promise<void> {
  try {
    const added = await call('workspace.importFiles', { parentPath })
    if (added.length === 0) return
    invalidate('workspace')
    toast(added.length === 1 ? `Added “${added[0].name}”.` : `Added ${added.length} files.`)
    if (added.length === 1) await openEntry(added[0])
  } catch (error) {
    reportError(error)
  }
}

export async function createQuickNote(): Promise<void> {
  try {
    const note = await call('notes.create')
    await call('workspace.markOpened', { id: note.id })
    store.setState({ section: 'notes', activeTabId: null, selectedNoteId: note.id })
    invalidate('workspace')
  } catch (error) {
    reportError(error)
  }
}

export async function renameEntry(entry: Entry): Promise<void> {
  const name = await promptDialog({
    title: `Rename ${entry.kind === 'folder' ? 'folder' : 'item'}`,
    label: 'Name',
    initialValue: displayTitle(entry.name, entry.kind),
    confirmLabel: 'Rename',
    validate: validateName
  })
  if (!name || name === displayTitle(entry.name, entry.kind)) return
  try {
    const state = store.getState()
    const renamed = await call('workspace.rename', { id: entry.id, name })
    if (entry.kind === 'folder' && isSameOrInside(state.folder, entry.relPath)) {
      store.setState({ folder: renamed.relPath + state.folder.slice(entry.relPath.length) })
    }
    await syncTabs()
    invalidate('workspace')
  } catch (error) {
    reportError(error)
  }
}

export async function deleteEntry(entry: Entry): Promise<boolean> {
  const title = displayTitle(entry.name, entry.kind)
  const openInside = store.getState().tabs.filter((tab) => isSameOrInside(tab.relPath, entry.relPath)).length
  const confirmed = await confirmDialog({
    title: `Delete “${title}”?`,
    body:
      entry.kind === 'folder'
        ? `This folder and everything inside it will be moved to the trash.${openInside > 0 ? ` ${plural(openInside, 'open document')} inside it will be closed.` : ''} You can restore it from Documents → Trash.`
        : entry.kind === 'latex_project'
          ? 'This LaTeX project and all of its files will be moved to the trash. You can restore it from Documents → Trash.'
          : `This file will be moved to the trash${openInside > 0 ? ' and its tab will be closed' : ''}. You can restore it from Documents → Trash.`,
    confirmLabel: 'Move to trash',
    danger: true
  })
  if (!confirmed) return false
  try {
    const state = store.getState()
    for (const tab of state.tabs) {
      if (isSameOrInside(tab.relPath, entry.relPath)) state.removeTab(tab.id)
    }
    await call('workspace.delete', { id: entry.id })
    if (isSameOrInside(state.folder, entry.relPath)) store.setState({ folder: entry.parentPath })
    if (state.selectedNoteId === entry.id) store.setState({ selectedNoteId: null })
    invalidate('workspace', 'flashcards')
    return true
  } catch (error) {
    reportError(error)
    return false
  }
}

export async function moveEntryTo(entry: Entry, targetParentPath: string): Promise<void> {
  if (targetParentPath === entry.parentPath) return
  try {
    await flushOne(entry.id)
    const state = store.getState()
    const moved = await call('workspace.move', { id: entry.id, targetParentPath })
    if (entry.kind === 'folder' && isSameOrInside(state.folder, entry.relPath)) {
      store.setState({ folder: moved.relPath + state.folder.slice(entry.relPath.length) })
    }
    await syncTabs()
    invalidate('workspace')
    if (moved.name !== entry.name) toast(`Kept both: the moved item is now “${moved.name}”.`)
  } catch (error) {
    reportError(error)
  }
}

export async function toggleFavorite(entry: Entry): Promise<void> {
  try {
    await call('workspace.setFavorite', { id: entry.id, value: !entry.isFavorite })
    invalidate('workspace')
  } catch (error) {
    reportError(error)
  }
}

export async function updateSettings(patch: Partial<Omit<Settings, 'workspacePath'>>): Promise<void> {
  try {
    const settings = await call('settings.update', patch)
    store.setState({ settings })
    invalidate('settings')
  } catch (error) {
    reportError(error)
  }
}

/**
 * Collapses the sidebar to an icon rail or expands it again; the choice is remembered. In a
 * narrow window the sidebar starts as the rail, and opening it there lasts until the window widens.
 */
export function toggleSidebar(): void {
  const { settings, narrow, narrowExpanded } = store.getState()
  if (narrow) {
    store.setState({ narrowExpanded: !narrowExpanded })
    return
  }
  if (!settings) return
  const sidebarCollapsed = !settings.sidebarCollapsed
  // Applied to the store first so the animation starts immediately, then persisted.
  store.setState({ settings: { ...settings, sidebarCollapsed } })
  void updateSettings({ sidebarCollapsed })
}

export function requestFlashcardDrafts(text: string, sourceEntryId: string | null): void {
  if (!text.trim()) {
    toast('Select some text first, then create flashcards from it.')
    return
  }
  store.setState({ draftRequest: { text, sourceEntryId } })
}

/** Opens the "Add to planner" dialog for text selected in a document. */
export function requestTaskFromSelection(text: string): void {
  if (!text.trim()) {
    toast('Select the text for the task first, then add it to the planner.')
    return
  }
  store.setState({ taskRequest: { text: text.slice(0, 8000) } })
}

export async function openExternalLink(url: string): Promise<void> {
  await call('app.openExternal', { url }).catch(reportError)
}
