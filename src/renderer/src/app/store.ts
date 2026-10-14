import { create } from 'zustand'
import type { AppInfo, DocumentKind, Entry, EntryKind, Settings } from '@shared/types'

export type Section = 'home' | 'documents' | 'notes' | 'flashcards' | 'planner' | 'focus' | 'settings'

export const SECTION_LABELS: Record<Section, string> = {
  home: 'Home',
  documents: 'Documents',
  notes: 'Quick Notes',
  flashcards: 'Flashcards',
  planner: 'Planner',
  focus: 'Focus',
  settings: 'Settings'
}

export interface Tab {
  id: string
  name: string
  kind: EntryKind
  relPath: string
}

export interface SaveState {
  status: 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'
  message?: string
}

export interface DraftRequest {
  text: string
  sourceEntryId: string | null
}

interface AppState {
  ready: boolean
  settings: Settings | null
  info: AppInfo | null
  section: Section
  tabs: Tab[]
  activeTabId: string | null
  /** The folder shown in the Documents section; also the default destination for new items. */
  folder: string
  paletteOpen: boolean
  quickOpen: boolean
  trashOpen: boolean
  newDialog: { open: boolean; parentPath: string; kind: DocumentKind | null }
  moveEntry: Entry | null
  draftRequest: DraftRequest | null
  /** Text selected in a document that the user asked to turn into a planner task. */
  taskRequest: { text: string } | null
  selectedNoteId: string | null
  studyRequest: { deckId: string | null } | null
  saveStates: Record<string, SaveState>
  statusText: Record<string, string>
  /** The window is too narrow for the full sidebar, so it shows as the rail unless opened by hand. */
  narrow: boolean
  /** The sidebar was opened by hand while the window is narrow. Not remembered. */
  narrowExpanded: boolean

  setSection(section: Section): void
  setFolder(folder: string): void
  activateTab(id: string): void
  addTab(tab: Tab): void
  removeTab(id: string): void
  setTabs(tabs: Tab[], activeTabId: string | null): void
  setSaveState(key: string, state: SaveState): void
  setStatusText(key: string, text: string): void
}

export const useAppStore = create<AppState>((set) => ({
  ready: false,
  settings: null,
  info: null,
  section: 'home',
  tabs: [],
  activeTabId: null,
  folder: '',
  paletteOpen: false,
  quickOpen: false,
  trashOpen: false,
  newDialog: { open: false, parentPath: '', kind: null },
  moveEntry: null,
  draftRequest: null,
  taskRequest: null,
  selectedNoteId: null,
  studyRequest: null,
  saveStates: {},
  statusText: {},
  narrow: false,
  narrowExpanded: false,

  setSection: (section) => set({ section, activeTabId: null }),
  setFolder: (folder) => set({ folder, section: 'documents', activeTabId: null }),
  activateTab: (id) => set({ activeTabId: id }),
  addTab: (tab) =>
    set((state) => ({
      tabs: state.tabs.some((existing) => existing.id === tab.id) ? state.tabs : [...state.tabs, tab],
      activeTabId: tab.id
    })),
  removeTab: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id)
      if (index === -1) return state
      const tabs = state.tabs.filter((tab) => tab.id !== id)
      const activeTabId = state.activeTabId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : state.activeTabId
      const { [id]: _saveState, ...saveStates } = state.saveStates
      const { [id]: _statusText, ...statusText } = state.statusText
      return { tabs, activeTabId, saveStates, statusText }
    }),
  setTabs: (tabs, activeTabId) => set({ tabs, activeTabId }),
  setSaveState: (key, saveState) => set((state) => ({ saveStates: { ...state.saveStates, [key]: saveState } })),
  setStatusText: (key, text) =>
    set((state) => (state.statusText[key] === text ? state : { statusText: { ...state.statusText, [key]: text } }))
}))

/** Whether the sidebar shows as the icon rail: the remembered choice, or a narrow window. */
export function selectSidebarCollapsed(state: AppState): boolean {
  return state.narrow ? !state.narrowExpanded : (state.settings?.sidebarCollapsed ?? false)
}
