import { MotionConfig } from 'motion/react'
import { useEffect, type ReactNode } from 'react'
import { isOpenable } from '@shared/domain/naming'
import { isMod } from './lib/platform'
import { THEMES } from '@shared/themes'
import { QuickOpen } from './app/QuickOpen'
import { TrashDialog } from './features/documents/TrashDialog'
import { pomodoro } from './features/pomodoro/controller'
import { loadUpdateState, setUpdateState } from './features/updates/updates'
import { closeTab, createFolderIn, showNewDialog, toggleSidebar } from './app/actions'
import { CommandPalette } from './app/CommandPalette'
import { NewDialog } from './app/NewDialog'
import { Shell } from './app/Shell'
import { useAppStore, type Tab } from './app/store'
import { confirmDialog, DialogHost } from './components/ui/dialogs'
import { Spinner, toast, Toaster } from './components/ui/feedback'
import { TooltipProvider } from './components/ui/overlays'
import { DraftsDialog } from './features/flashcards/DraftsDialog'
import { AddTaskDialog } from './features/planner/AddTaskDialog'
import { MoveDialog } from './features/workspace/MoveDialog'
import { call } from './lib/api'
import { invalidate } from './lib/useData'
import { flushAll } from './lib/useSaver'
import { plural } from './lib/utils'

async function restoreSession(): Promise<void> {
  const [settings, info, session] = await Promise.all([call('settings.get'), call('app.info'), call('session.get')])
  const tabs: Tab[] = []
  for (const id of session.tabs) {
    const entry = await call('workspace.get', { id }).catch(() => null)
    if (entry && isOpenable(entry.kind)) {
      tabs.push({ id: entry.id, name: entry.name, kind: entry.kind, relPath: entry.relPath })
    }
  }
  const activeTabId = tabs.some((tab) => tab.id === session.activeTabId) ? session.activeTabId : null
  useAppStore.setState({ settings, info, tabs, activeTabId, ready: true })
}

/**
 * The window is closing: save everything and remember the open tabs. If something could not be
 * saved (a failed save or a file changed on disk), the close is held and the user decides.
 */
async function closeWindow(): Promise<void> {
  const { tabs, activeTabId } = useAppStore.getState()
  await flushAll()
  await call('session.save', { tabs: tabs.map((tab) => tab.id), activeTabId }).catch(() => undefined)
  const unsaved = Object.values(useAppStore.getState().saveStates).filter((state) => state.status !== 'saved').length
  if (unsaved === 0) {
    await call('app.closeDecision', { action: 'proceed' })
    return
  }
  await call('app.closeDecision', { action: 'hold' })
  const discard = await confirmDialog({
    title: 'Close without saving?',
    body: `${plural(unsaved, 'document has', 'documents have')} changes that could not be saved. If you close now, those changes will be lost.`,
    confirmLabel: 'Close and discard changes',
    danger: true
  })
  if (discard) await call('app.closeDecision', { action: 'proceed' })
}

function useTheme(): void {
  const theme = useAppStore((state) => state.settings?.theme)
  const accent = useAppStore((state) => state.settings?.accent)
  // The preload script applies the saved theme before the first paint; this keeps the page
  // and the window chrome in step whenever the setting changes afterwards.
  useEffect(() => {
    if (!theme || !accent) return
    const root = document.documentElement
    for (const name of [...root.classList]) {
      if (name.startsWith('theme-') || name.startsWith('accent-')) root.classList.remove(name)
    }
    root.classList.add(`theme-${theme}`)
    root.classList.toggle('dark', THEMES[theme].dark)
    if (accent !== 'theme') root.classList.add(`accent-${accent}`)
    void call('app.setChrome', { theme }).catch(() => undefined)
  }, [theme, accent])
}

/** Starts the Pomodoro timer's clock and re-reads it whenever time may have jumped. */
function usePomodoroClock(): void {
  const ready = useAppStore((state) => state.ready)
  useEffect(() => {
    if (!ready) return
    void pomodoro.load().catch(() => undefined)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') pomodoro.resync()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [ready])
}

function useAppEvents(): void {
  useEffect(() => void loadUpdateState().catch(() => undefined), [])
  useEffect(
    () =>
      window.appEvents.subscribe((event) => {
        if (event.type === 'flush-request') {
          void closeWindow()
        } else if (event.type === 'reminder-fired') {
          toast(event.missed ? `Missed reminder: ${event.title}` : `Reminder: ${event.title}`)
          invalidate('planner')
        } else if (event.type === 'workspace-changed') {
          invalidate('workspace')
        } else if (event.type === 'update-state') {
          setUpdateState(event.state)
        } else if (event.type === 'power-resume') {
          pomodoro.resync()
        }
      }),
    []
  )
}

function useSessionPersistence(): void {
  const ready = useAppStore((state) => state.ready)
  const tabs = useAppStore((state) => state.tabs)
  const activeTabId = useAppStore((state) => state.activeTabId)
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => void call('session.save', { tabs: tabs.map((tab) => tab.id), activeTabId }).catch(() => undefined), 400)
    return () => clearTimeout(timer)
  }, [ready, tabs, activeTabId])
}

function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isMod(event) || event.altKey) return
      const state = useAppStore.getState()
      const key = event.key.toLowerCase()
      const handled = (): void => {
        event.preventDefault()
        event.stopPropagation()
      }
      if (key === 'p' && !event.shiftKey) {
        // Quick Open: jump to a document or folder by name.
        handled()
        useAppStore.setState({ quickOpen: !state.quickOpen, paletteOpen: false })
      } else if ((key === 'k' && !event.shiftKey) || key === 'p') {
        handled()
        useAppStore.setState({ paletteOpen: !state.paletteOpen, quickOpen: false })
      } else if (key === 'n' && event.shiftKey) {
        handled()
        void createFolderIn(state.section === 'documents' && !state.activeTabId ? state.folder : '')
      } else if (key === 'n') {
        handled()
        showNewDialog()
      } else if (key === 'w' && state.activeTabId) {
        handled()
        void closeTab(state.activeTabId)
      } else if (key === 'tab' && state.tabs.length > 0) {
        handled()
        const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId)
        const next = (index + (event.shiftKey ? -1 : 1) + state.tabs.length) % state.tabs.length
        state.activateTab(state.tabs[index === -1 ? 0 : next].id)
      } else if (key === '\\') {
        handled()
        toggleSidebar()
      } else if (key === ',') {
        handled()
        state.setSection('settings')
      } else if (key === 's') {
        handled()
        void flushAll()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}

export function App(): ReactNode {
  const ready = useAppStore((state) => state.ready)
  useEffect(() => {
    void restoreSession().catch((error) => toast(`The app could not load its settings: ${String(error)}`, 'error'))
  }, [])
  useTheme()
  useAppEvents()
  useSessionPersistence()
  useGlobalShortcuts()
  usePomodoroClock()

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={18} />
      </div>
    )
  }
  return (
    // reducedMotion="user": with "reduce motion" on in Windows, Motion skips transform and
    // layout animations and keeps only opacity changes.
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={450} skipDelayDuration={200}>
        <Shell />
        <NewDialog />
        <MoveDialog />
        <TrashDialog />
        <DraftsDialog />
        <AddTaskDialog />
        <CommandPalette />
        <QuickOpen />
        <DialogHost />
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  )
}
