import { ChevronRight, HardDrive, Mountain, PanelLeft, Search, WifiOff, X } from 'lucide-react'
import { motion } from 'motion/react'
import { Fragment, useEffect, type ReactNode } from 'react'
import { displayTitle } from '@shared/domain/naming'
import { IconButton } from '@/components/ui/button'
import { EASE_OUT, Kbd, SaveBadge } from '@/components/ui/feedback'
import { Tip } from '@/components/ui/overlays'
import { DocumentHost } from '@/features/documents/DocumentHost'
import { HomeView } from '@/features/home/HomeView'
import { EntryIcon } from '@/features/workspace/EntryIcon'
import { PomodoroPill } from '@/features/pomodoro/PomodoroView'
import { UpdatePill } from '@/features/updates/updates'
import { loadable } from '@/lib/loadable'
import { IS_MAC } from '@/lib/platform'
import { cn, workspaceName } from '@/lib/utils'
import { closeTab, toggleSidebar } from './actions'
import { Sidebar } from './Sidebar'
import { SECTION_LABELS, selectSidebarCollapsed, useAppStore } from './store'

/** Where you are: the section name, or the folder path down to the open document. */
function Breadcrumbs(): ReactNode {
  const section = useAppStore((state) => state.section)
  const folder = useAppStore((state) => state.folder)
  const tab = useAppStore((state) => state.tabs.find((candidate) => candidate.id === state.activeTabId))
  const workspacePath = useAppStore((state) => state.info?.workspacePath)
  const setFolder = useAppStore((state) => state.setFolder)

  const path = tab ? tab.relPath : section === 'documents' ? folder : null
  const segments = path ? path.split('/') : []
  const crumb = 'no-drag rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-fg'

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-[12.5px]">
      {path === null ? (
        <span className="px-1.5 font-medium text-fg">{SECTION_LABELS[section]}</span>
      ) : (
        <>
          <button type="button" className={crumb} onClick={() => setFolder('')} title={workspacePath} aria-label="Workspace root">
            <Mountain size={13} />
          </button>
          {segments.map((segment, index) => {
            const last = index === segments.length - 1
            const target = segments.slice(0, index + 1).join('/')
            return (
              <Fragment key={target}>
                <ChevronRight size={12} className="shrink-0 text-subtle" />
                {last ? (
                  <span className="truncate px-1.5 font-medium text-fg">{tab ? displayTitle(segment, tab.kind) : segment}</span>
                ) : (
                  <button type="button" className={cn(crumb, 'truncate')} onClick={() => setFolder(target)}>
                    {segment}
                  </button>
                )}
              </Fragment>
            )
          })}
        </>
      )}
    </nav>
  )
}

/**
 * The single top bar: sidebar toggle, location, save state, and search. It doubles as the
 * window's drag region; the right padding leaves room for the native caption buttons.
 */
function TopBar(): ReactNode {
  const collapsed = useAppStore(selectSidebarCollapsed)
  const activeTabId = useAppStore((state) => state.activeTabId)
  const saveState = useAppStore((state) => (state.activeTabId ? state.saveStates[state.activeTabId] : undefined))
  return (
    <header className={cn('drag-region flex h-10 shrink-0 items-center gap-2 border-b border-line bg-bg pl-2', IS_MAC ? 'pr-3' : 'pr-[148px]')}>
      <IconButton label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} shortcut="Ctrl+\" className="no-drag" onClick={toggleSidebar}>
        <PanelLeft size={15} />
      </IconButton>
      <Breadcrumbs />
      {activeTabId && <SaveBadge state={saveState} />}
      <PomodoroPill />
      <UpdatePill />
      {/* In a narrow window the search box shrinks to its icon. */}
      <button
        type="button"
        aria-label="Search or run a command"
        onClick={() => useAppStore.setState({ paletteOpen: true })}
        className="no-drag flex h-7 w-[248px] shrink-0 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-xs text-subtle hover:border-line-strong hover:text-muted max-[780px]:w-7 max-[780px]:justify-center max-[780px]:px-0"
      >
        <Search size={13} className="shrink-0" />
        <span className="flex flex-1 items-center gap-2 max-[780px]:hidden">
          <span className="flex-1 truncate text-left whitespace-nowrap">Search or run a command</span>
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
    </header>
  )
}

function TabBar(): ReactNode {
  const tabs = useAppStore((state) => state.tabs)
  const activeTabId = useAppStore((state) => state.activeTabId)
  const saveStates = useAppStore((state) => state.saveStates)
  const activateTab = useAppStore((state) => state.activateTab)
  if (tabs.length === 0) return null
  return (
    <div role="tablist" aria-label="Open documents" className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-bg px-1.5">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        const unsaved = ['dirty', 'error', 'conflict'].includes(saveStates[tab.id]?.status ?? 'saved')
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            title={tab.relPath}
            onClick={() => activateTab(tab.id)}
            onKeyDown={(event) => event.key === 'Enter' && activateTab(tab.id)}
            onAuxClick={(event) => event.button === 1 && void closeTab(tab.id)}
            className={cn(
              'group relative flex max-w-[220px] min-w-[112px] cursor-default items-center gap-2 px-3 text-xs',
              active ? 'text-fg' : 'text-muted hover:text-fg'
            )}
          >
            <EntryIcon kind={tab.kind} size={13} />
            <span className="flex-1 truncate">{displayTitle(tab.name, tab.kind)}</span>
            <button
              type="button"
              aria-label={`Close ${tab.name}`}
              onClick={(event) => {
                event.stopPropagation()
                void closeTab(tab.id)
              }}
              className="flex h-[18px] w-[18px] items-center justify-center rounded text-subtle hover:bg-active hover:text-fg"
            >
              {unsaved ? <span className="h-1.5 w-1.5 rounded-full bg-warning group-hover:hidden" /> : null}
              <X size={12} className={cn(unsaved ? 'hidden group-hover:block' : 'opacity-0 group-hover:opacity-100', active && !unsaved && 'opacity-50')} />
            </button>
            {/* The underline slides from the previous tab to this one. */}
            {active && (
              <motion.span
                layoutId="tab-underline"
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent"
                transition={{ duration: 0.22, ease: EASE_OUT }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function StatusBar(): ReactNode {
  const workspacePath = useAppStore((state) => state.info?.workspacePath)
  const status = useAppStore((state) => (state.activeTabId ? state.statusText[state.activeTabId] : undefined))
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-bg px-3 text-[11px] text-subtle">
      <Tip label={workspacePath ?? ''} side="top">
        <button type="button" onClick={() => useAppStore.getState().setFolder('')} className="flex items-center gap-1.5 hover:text-fg" data-testid="workspace-indicator">
          <HardDrive size={11} />
          {workspaceName(workspacePath)}
        </button>
      </Tip>
      <span className="flex-1" />
      {status && (
        <span className="whitespace-nowrap tabular-nums" data-testid="editor-status">
          {status}
        </span>
      )}
      <Tip label="This app never uses the network. Everything is stored on this computer." side="top">
        <span className="flex items-center gap-1.5">
          <WifiOff size={11} />
          Local only
        </span>
      </Tip>
    </footer>
  )
}

// Home is part of the first load; every other screen is fetched the first time it is opened.
const DocumentsView = loadable(() => import('@/features/documents/DocumentsView').then((module) => module.DocumentsView))
const FlashcardsView = loadable(() => import('@/features/flashcards/FlashcardsView').then((module) => module.FlashcardsView))
const PlannerView = loadable(() => import('@/features/planner/PlannerView').then((module) => module.PlannerView))
const PomodoroView = loadable(() => import('@/features/pomodoro/PomodoroView').then((module) => module.PomodoroView))
const QuickNotesView = loadable(() => import('@/features/quick-notes/QuickNotesView').then((module) => module.QuickNotesView))
const SettingsView = loadable(() => import('@/features/settings/SettingsView').then((module) => module.SettingsView))

function SectionView(): ReactNode {
  const section = useAppStore((state) => state.section)
  switch (section) {
    case 'home':
      return <HomeView />
    case 'documents':
      return <DocumentsView />
    case 'notes':
      return <QuickNotesView />
    case 'flashcards':
      return <FlashcardsView />
    case 'planner':
      return <PlannerView />
    case 'focus':
      return <PomodoroView />
    case 'settings':
      return <SettingsView />
  }
}

/** Below this width (CSS pixels) the sidebar folds to the rail unless it is opened by hand. */
const NARROW_WIDTH = 900

function useNarrowWindow(): void {
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${NARROW_WIDTH - 0.02}px)`)
    const apply = () => useAppStore.setState({ narrow: query.matches, narrowExpanded: false })
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])
}

export function Shell(): ReactNode {
  useNarrowWindow()
  const tabs = useAppStore((state) => state.tabs)
  const activeTabId = useAppStore((state) => state.activeTabId)
  const section = useAppStore((state) => state.section)
  return (
    <div className="flex h-full bg-bg text-fg">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <TabBar />
        <div className="relative min-h-0 flex-1">
          {activeTabId === null && (
            // A new section fades up into place. There is no exit animation, so navigation
            // is never delayed by the screen being left.
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              className="absolute inset-0 overflow-hidden"
            >
              <SectionView />
            </motion.div>
          )}
          {/* Open documents stay mounted while hidden so each keeps its undo history. The fade
              restarts whenever a hidden tab is shown again. */}
          {tabs.map((tab) => (
            <div key={tab.id} className={cn('animate-fade absolute inset-0 overflow-hidden', tab.id !== activeTabId && 'hidden')}>
              <DocumentHost tab={tab} active={tab.id === activeTabId} />
            </div>
          ))}
        </div>
        <StatusBar />
      </main>
    </div>
  )
}
