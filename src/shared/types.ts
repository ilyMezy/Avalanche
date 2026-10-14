import type { FinishedSession, PomodoroSettings, PomodoroState } from './domain/pomodoro'
import type { Presentation } from './domain/slides'
import type { AccentId, ThemeId } from './themes'

export type EntryKind = 'folder' | 'docx' | 'markdown' | 'latex_project' | 'slides' | 'pdf' | 'image' | 'other'
export type DocumentKind = 'docx' | 'markdown' | 'latex_project' | 'slides'

export interface Entry {
  id: string
  name: string
  /** Workspace-relative path with forward slashes. */
  relPath: string
  /** Workspace-relative path of the containing folder; '' is the workspace root. */
  parentPath: string
  kind: EntryKind
  sizeBytes: number
  createdAt: number
  modifiedAt: number
  isFavorite: boolean
  isPinned: boolean
  lastOpenedAt: number | null
}

export interface FolderNode {
  id: string
  name: string
  relPath: string
  children: FolderNode[]
}

export interface SearchHit {
  entry: Entry
  match: 'name' | 'content'
  snippet: string | null
}

export interface QuickNote extends Entry {
  preview: string
}

export interface TextDocument {
  content: string
  /** Hash of the bytes on disk when read; sent back on save for conflict detection. */
  version: string
}

export interface SaveResult {
  version: string
  modifiedAt: number
}

export interface TiptapMark {
  type: string
  attrs?: Record<string, unknown>
}
export interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: TiptapMark[]
}

export interface DocxDocument {
  /** Editor model stored by this app, when the file was last written by it. */
  doc: TiptapNode | null
  /** HTML produced by the local importer, for files written by another program. */
  html: string | null
  version: string
  importWarnings: string[]
}

export interface SlidesDocument {
  presentation: Presentation
  version: string
  /** True when the file was written by another program and converted for editing. */
  imported: boolean
  importWarnings: string[]
}

export interface LatexFile {
  relPath: string
  isDirectory: boolean
  editable: boolean
}
export interface LatexProject {
  entryFile: string
  engine: string
  files: LatexFile[]
  hasPdf: boolean
}
export interface TexToolchain {
  available: boolean
  distribution: 'MiKTeX' | 'TeX Live' | 'unknown' | null
  version: string | null
  enginePath: string | null
}
export interface CompileIssue {
  severity: 'error' | 'warning'
  message: string
  file: string | null
  line: number | null
}
export interface CompileResult {
  status: 'success' | 'failed' | 'no-compiler' | 'timeout' | 'busy'
  /** Number of engine passes that actually ran. Zero means nothing was compiled. */
  passes: number
  durationMs: number
  issues: CompileIssue[]
  log: string
  pdfUpdated: boolean
}

export type CardState = 'new' | 'learning' | 'review'
export type Rating = 'again' | 'hard' | 'good' | 'easy'

export interface Deck {
  id: string
  /** Parent deck, or null for a top-level deck. */
  parentId: string | null
  /** Nesting level in the tree: 0 for top-level decks. */
  depth: number
  /** Counts including every subdeck beneath this one. */
  subtreeTotal: number
  subtreeNew: number
  subtreeDue: number
  name: string
  /** Identifiers from shared/domain/deck-style.ts; unknown values are shown as the defaults. */
  icon: string
  color: string
  newPerDay: number
  createdAt: number
  updatedAt: number
  totalCount: number
  newCount: number
  dueCount: number
}
export interface Card {
  id: string
  deckId: string
  position: number
  front: string
  back: string
  extra: string
  tags: string
  state: CardState
  repetitions: number
  intervalDays: number
  easeFactor: number
  lapses: number
  dueDate: string | null
  lastReviewDate: string | null
  sourceEntryId: string | null
  sourcePathSnapshot: string | null
  sourceExcerpt: string | null
  createdAt: number
  updatedAt: number
}
export interface StudyCard extends Card {
  deckName: string
}
export interface FlashcardSummary {
  dueCount: number
  newAvailable: number
  deckCount: number
}

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly'

export interface Reminder {
  id: string
  taskId: string | null
  title: string
  localDate: string
  localTime: string
  recurrence: Recurrence
  enabled: boolean
  nextDueAt: number | null
  lastFiredAt: number | null
  /** True when the last occurrence came due while the app was not running. */
  missed: boolean
}
export interface Task {
  id: string
  title: string
  notes: string
  dueDate: string | null
  dueTime: string | null
  completedAt: number | null
  createdAt: number
  updatedAt: number
  reminder: Reminder | null
}

export type ThemeSetting = ThemeId

/** A document in the sidebar's Frequent list. */
export interface FrequentDoc extends Entry {
  pinned: boolean
  /** True when the file is no longer on disk; the row offers to remove the stale entry. */
  missing: boolean
}

export interface TrashItem {
  id: string
  name: string
  originalRelPath: string
  kind: EntryKind
  deletedAt: number
}

export type DuplicatePolicy = 'all' | 'skip' | 'update'

export interface ImportSummary {
  imported: number
  /** Cards left out because an identical question already exists in the deck (or earlier in the file). */
  skipped: number
  /** Existing cards whose answer, extra, or tags were replaced. Their review history is kept. */
  updated: number
}

export interface PomodoroSnapshot {
  settings: PomodoroSettings
  state: PomodoroState
  /** Focus sessions completed since local midnight. */
  completedToday: number
  history: FinishedSession[]
}

export interface Settings {
  theme: ThemeSetting
  /** Optional accent colour override; 'theme' keeps the theme's own accent. */
  accent: AccentId
  /** Absolute path of the workspace root. */
  workspacePath: string
  newDocumentBehavior: 'ask' | DocumentKind
  quickNotesFolder: string
  autosaveDelayMs: number
  editorFontSize: number
  markdownPreview: 'off' | 'split' | 'preview'
  sidebarWidth: number
  sidebarCollapsed: boolean
  /** Size of the whole interface: 1 is the original size, 1.15 the default. */
  uiScale: number
  /** Corrects common slips and capitalizes sentences as you type in documents. */
  autocorrect: boolean
  /** Writes the answer after a sum followed by "=" in documents and notes. */
  autoMath: boolean
  /** Offers to finish the word being typed from words already in the document (Tab accepts). */
  wordCompletion: boolean
  /** Whether the app looks for a newer version on its own. A manual check always works. */
  checkForUpdates: boolean
  /**
   * How the document page looks on screen: 'theme' follows the app theme (a dark writing
   * surface in dark mode), 'paper' is always a white sheet. Never affects saved files.
   */
  docxPage: 'theme' | 'paper'
}

/** What the window needs before its first paint, passed by the main process at creation. */
export interface BootInfo {
  theme: ThemeSetting
  accent: AccentId
}

export interface SessionState {
  tabs: string[]
  activeTabId: string | null
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  userDataPath: string
  databasePath: string
  backupsPath: string
  workspacePath: string
  defaultWorkspacePath: string
}

/** Where the app is in finding, downloading, and installing a newer version. */
export interface UpdateState {
  status: 'disabled' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'
  currentVersion: string
  /** The newer version, once one has been found. */
  version: string | null
  /** Release notes as plain text. */
  notes: string
  /** Download progress, 0 to 100. */
  percent: number
  /** Why updates are disabled, or what went wrong. */
  message: string
  checkedAt: number | null
}

export type AppEvent =
  | { type: 'update-state'; state: UpdateState }
  | { type: 'reminder-fired'; reminderId: string; title: string; missed: boolean }
  | { type: 'flush-request' }
  | { type: 'workspace-changed' }
  /** The computer woke from sleep; anything that depends on elapsed time should re-read the clock. */
  | { type: 'power-resume' }
