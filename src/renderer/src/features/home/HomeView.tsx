import { Bell, CalendarCheck, Check, ChevronRight, Files, FolderPlus, Layers, LayoutDashboard, Plus, StickyNote, Timer } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { addableTypes, addWidget, moveWidget, removeWidget, switchColumn, WIDGET_LABELS, type HomeColumn, type HomeWidget } from '@shared/domain/home'
import { displayTitle } from '@shared/domain/naming'
import type { DocumentKind, Entry, FlashcardSummary, FolderNode, Reminder, Task } from '@shared/types'
import { createFolderIn, createQuickNote, openEntry, showNewDialog } from '@/app/actions'
import { useAppStore } from '@/app/store'
import { Ridges } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { ActionMenu, type MenuEntry } from '@/components/ui/overlays'
import { usePomodoro } from '@/features/pomodoro/controller'
import { EntryIcon } from '@/features/workspace/EntryIcon'
import { ClockWidget, CountdownWidget, FocusWidget, MiniCalendarWidget, YearWidget } from './DotWidgets'
import { GoalsWidget, NoteWidget, PictureWidget, Section, useHome, useHomeImage, WidgetControls } from './HomeWidgets'
import { call } from '@/lib/api'
import { invalidate, useData } from '@/lib/useData'
import { cn, formatDue, formatTimestamp, greeting, longDate, plural, todayString } from '@/lib/utils'

function MoreLink({ children, onClick }: { children: ReactNode; onClick(): void }): ReactNode {
  return (
    <button type="button" onClick={onClick} className="-mr-2 flex items-center gap-0.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-hover hover:text-fg">
      {children}
      <ChevronRight size={14} />
    </button>
  )
}

/** A one-line empty state with its action, sized to sit inside a card. */
function Quiet({ icon, text, action, onAction }: { icon: ReactNode; text: string; action?: string; onAction?(): void }): ReactNode {
  return (
    <div className="flex items-center gap-3.5 py-2 text-[13px] text-muted">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-hover text-subtle">{icon}</span>
      <span className="min-w-0 flex-1 leading-relaxed">{text}</span>
      {action && onAction && <Button onClick={onAction}>{action}</Button>}
    </div>
  )
}

function EntryRow({ entry, onOpen }: { entry: Entry; onOpen(): void }): ReactNode {
  return (
    <button type="button" onClick={onOpen} className="group -mx-2 flex h-11 w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 text-left hover:bg-hover">
      <EntryIcon kind={entry.kind} size={18} />
      <span className="min-w-0 flex-1 truncate text-[14px] text-fg">{displayTitle(entry.name, entry.kind)}</span>
      {entry.parentPath && <span className="max-w-[34%] truncate text-[13px] text-subtle">{entry.parentPath}</span>}
      <span className="w-[104px] shrink-0 text-right text-[13px] text-subtle tabular-nums">{formatTimestamp(entry.lastOpenedAt ?? entry.modifiedAt)}</span>
    </button>
  )
}

const CREATE: { kind: DocumentKind; label: string; hint: string }[] = [
  { kind: 'docx', label: 'New document', hint: 'Essays and reports' },
  { kind: 'slides', label: 'New slides', hint: 'A presentation' },
  { kind: 'markdown', label: 'New Markdown note', hint: 'Plain-text notes' },
  { kind: 'latex_project', label: 'New LaTeX project', hint: 'Papers with equations' }
]

/** A large number with what it counts. The whole card is the button that takes you there. */
function Stat({ icon, value, label, detail, action, onClick }: { icon: ReactNode; value: number; label: string; detail: ReactNode; action: string; onClick(): void }): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${value} ${label}. ${action}`}
      className="group flex items-center gap-4 rounded-2xl border border-line bg-surface px-5 py-4 text-left transition-colors duration-100 hover:border-line-strong hover:bg-hover"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[30px] leading-9 font-semibold tracking-tight text-fg tabular-nums">{value}</span>
          <span className="text-[14px] text-fg">{label}</span>
        </span>
        <span className="block text-[13px] text-muted">{detail}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-subtle group-hover:text-fg" />
    </button>
  )
}

/** The start page: genuine local data only, with useful actions when there is none yet. */
export function HomeView(): ReactNode {
  const setSection = useAppStore((state) => state.setSection)
  const setFolder = useAppStore((state) => state.setFolder)
  const recentDocs = useData<Entry[]>(['workspace'], () => call('workspace.recents', { limit: 7, scope: 'documents' }))
  const recentNotes = useData<Entry[]>(['workspace'], () => call('workspace.recents', { limit: 4, scope: 'notes' }))
  const folders = useData<FolderNode[]>(['workspace'], () => call('workspace.tree'))
  const tasks = useData<Task[]>(['planner'], () => call('planner.tasks'))
  const reminders = useData<Reminder[]>(['planner'], () => call('planner.reminders'))
  const cards = useData<FlashcardSummary>(['flashcards'], () => call('flashcards.summary'))
  const focusToday = usePomodoro((state) => state.completedToday)
  const { config, change } = useHome()
  const [customizing, setCustomizing] = useState(false)
  const heroImage = useHomeImage(config?.heroImage ?? null)

  const today = todayString()
  const todaysTasks = (tasks.data ?? [])
    .filter((task) => task.completedAt === null && task.dueDate !== null && task.dueDate <= today)
    .sort((a, b) => `${a.dueDate} ${a.dueTime ?? '99'}`.localeCompare(`${b.dueDate} ${b.dueTime ?? '99'}`))
  const overdue = todaysTasks.filter((task) => task.dueDate! < today).length
  const upcomingReminders = (reminders.data ?? []).filter((reminder) => reminder.enabled && reminder.nextDueAt !== null).slice(0, 4)
  const missedReminders = (reminders.data ?? []).filter((reminder) => reminder.missed)
  const studyable = (cards.data?.dueCount ?? 0) + (cards.data?.newAvailable ?? 0)

  const completeTask = async (task: Task): Promise<void> => {
    await call('planner.setCompleted', { id: task.id, completed: true }).catch(() => undefined)
    invalidate('planner')
  }
  const openNote = (note: Entry): void => useAppStore.setState({ section: 'notes', activeTabId: null, selectedNoteId: note.id })
  const startStudy = (): void => useAppStore.setState({ section: 'flashcards', activeTabId: null, studyRequest: { deckId: null } })

  const addItems = (column: HomeColumn): MenuEntry[] =>
    config ? addableTypes(config).map((type) => ({ label: WIDGET_LABELS[type], onSelect: () => change((current) => addWidget(current, type, column)) })) : []

  const renderWidget = (widget: HomeWidget): ReactNode => {
    if (!config) return null
    switch (widget.type) {
      case 'goals':
        return <GoalsWidget config={config} change={change} />
      case 'image':
        return <PictureWidget widget={widget} editing={customizing} change={change} />
      case 'text':
        return <NoteWidget widget={widget} editing={customizing} change={change} />
      case 'clock':
        return <ClockWidget />
      case 'countdown':
        return <CountdownWidget widget={widget} editing={customizing} change={change} />
      case 'focus':
        return <FocusWidget />
      case 'calendar':
        return <MiniCalendarWidget tasks={tasks.data ?? []} />
      case 'yearProgress':
        return <YearWidget />
      case 'recentDocuments':
        return (
          <Section title="Recent documents" action={<MoreLink onClick={() => setSection('documents')}>All documents</MoreLink>}>
            {recentDocs.data?.length ? (
              recentDocs.data.map((entry) => <EntryRow key={entry.id} entry={entry} onOpen={() => void openEntry(entry)} />)
            ) : (
              <Quiet icon={<Files size={17} />} text="Documents you open appear here so you can pick up where you left off. Create one with the buttons above." />
            )}
          </Section>
        )
      case 'folders':
        return (
          <Section
            title="Folders"
            action={
              <button type="button" onClick={() => void createFolderIn('')} className="-mr-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-hover hover:text-fg">
                <FolderPlus size={14} />
                New folder
              </button>
            }
          >
            {folders.data?.length ? (
              <div className="grid grid-cols-2 gap-x-3">
                {folders.data.map((folder) => (
                  <button key={folder.id} type="button" onClick={() => setFolder(folder.relPath)} className="-mx-2 flex h-11 items-center gap-3 rounded-lg px-2 text-left hover:bg-hover">
                    <EntryIcon kind="folder" size={18} />
                    <span className="min-w-0 flex-1 truncate text-[14px]">{folder.name}</span>
                    {folder.children.length > 0 && <span className="text-[13px] text-subtle tabular-nums">{folder.children.length}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <Quiet icon={<Files size={17} />} text="No folders yet. Folders are real directories on disk; use them to organize work by subject or project." />
            )}
          </Section>
        )
      case 'today':
        return (
          <Section title="Today" action={<MoreLink onClick={() => setSection('planner')}>Planner</MoreLink>}>
            {todaysTasks.length ? (
              todaysTasks.slice(0, 6).map((task) => (
                <div key={task.id} className="-mx-2 flex h-11 items-center gap-3 rounded-lg px-2 hover:bg-hover">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={false}
                    aria-label={`Mark “${task.title}” as done`}
                    onClick={() => void completeTask(task)}
                    className="group flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-strong hover:border-accent"
                  >
                    <Check size={13} strokeWidth={3} className="text-accent-text opacity-0 group-hover:opacity-100" />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-[14px]">{task.title}</span>
                  <span className={cn('shrink-0 text-[13px] tabular-nums', task.dueDate! < today ? 'text-danger' : 'text-muted')}>{formatDue(task.dueDate!, task.dueTime)}</span>
                </div>
              ))
            ) : (
              <Quiet icon={<CalendarCheck size={17} />} text="Nothing is due today." action="Add a task" onAction={() => setSection('planner')} />
            )}
          </Section>
        )
      case 'reminders':
        return (
          <Section title="Reminders">
            {missedReminders.length > 0 && (
              <div className="mb-2 rounded-lg bg-warning/10 px-3 py-2.5 text-[13px] leading-relaxed text-fg">
                {plural(missedReminders.length, 'reminder')} came due while the app was closed.{' '}
                <button type="button" className="text-accent-text hover:underline" onClick={() => setSection('planner')}>
                  Review in Planner
                </button>
              </div>
            )}
            {upcomingReminders.length ? (
              upcomingReminders.map((reminder) => (
                <div key={reminder.id} className="flex h-11 items-center gap-3">
                  <Bell size={16} className="shrink-0 text-subtle" />
                  <span className="min-w-0 flex-1 truncate text-[14px]">{reminder.title}</span>
                  <span className="shrink-0 text-[13px] text-muted tabular-nums">{formatTimestamp(reminder.nextDueAt!)}</span>
                </div>
              ))
            ) : (
              <Quiet icon={<Bell size={17} />} text="No upcoming reminders. Add one from a task or the Reminders tab in Planner." />
            )}
          </Section>
        )
      case 'recentNotes':
        return (
          <Section title="Recent quick notes" action={<MoreLink onClick={() => setSection('notes')}>All notes</MoreLink>}>
            {recentNotes.data?.length ? (
              recentNotes.data.map((note) => <EntryRow key={note.id} entry={note} onOpen={() => openNote(note)} />)
            ) : (
              <Quiet icon={<StickyNote size={17} />} text="No quick notes yet. Capture a thought in one click." action="New note" onAction={() => void createQuickNote()} />
            )}
          </Section>
        )
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* The greeting sits on the page's one decorative surface: a ridge line drawn from theme
          tokens a shade or two from the background, so the text over it stays readable. */}
      <div
        className={cn('relative overflow-hidden border-b border-line', heroImage ? 'bg-cover bg-center' : 'hero-wash')}
        style={heroImage ? { backgroundImage: `url("${heroImage}")` } : undefined}
        data-testid="home-hero"
      >
        {heroImage ? (
          // A picture of the user's own: darkened on the left so the greeting stays readable on it.
          <div className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/35 to-black/10" aria-hidden />
        ) : (
          <Ridges className="absolute inset-x-0 bottom-0 h-[110px] w-full" />
        )}
        <header className="relative mx-auto flex max-w-[1240px] flex-wrap items-end justify-between gap-4 px-10 pt-10 pb-9">
          <div>
            <h1 className={cn('text-[34px] leading-10 font-semibold tracking-tight', heroImage && 'text-white drop-shadow')}>{greeting()}</h1>
            <p className={cn('mt-1.5 text-[15px]', heroImage ? 'text-white/85 drop-shadow' : 'text-muted')}>{longDate.format(new Date())}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button className="h-10 px-4 text-[14px]" onClick={() => void createQuickNote()}>
              <StickyNote size={16} />
              New quick note
            </Button>
            <Button className="h-10 px-4 text-[14px]" variant={customizing ? 'primary' : 'secondary'} aria-pressed={customizing} onClick={() => setCustomizing(!customizing)}>
              <LayoutDashboard size={16} />
              {customizing ? 'Done' : 'Customize'}
            </Button>
          </div>
        </header>
      </div>

      <div className="mx-auto max-w-[1240px] space-y-5 px-10 pt-7 pb-16">
        <nav aria-label="Create" className="grid grid-cols-2 gap-3 min-[1400px]:grid-cols-4">
          {CREATE.map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => showNewDialog('', item.kind)}
              className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface px-4 py-3.5 text-left transition-colors duration-100 hover:border-line-strong hover:bg-hover"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-bg">
                <EntryIcon kind={item.kind} size={21} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium text-fg">{item.label}</span>
                <span className="block truncate text-[13px] text-muted">{item.hint}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-3">
          <Stat
            icon={<CalendarCheck size={22} />}
            value={todaysTasks.length}
            label={todaysTasks.length === 1 ? 'task due' : 'tasks due'}
            detail={overdue > 0 ? <span className="text-danger">{overdue} overdue</span> : todaysTasks.length > 0 ? 'Due today' : 'Nothing due today'}
            action="Open the planner"
            onClick={() => setSection('planner')}
          />
          <Stat
            icon={<Layers size={22} />}
            value={studyable}
            label={studyable === 1 ? 'card to study' : 'cards to study'}
            detail={
              cards.data && cards.data.deckCount > 0 ? (
                <>
                  <span data-testid="home-due">{plural(cards.data.dueCount, 'card')} due for review</span> · {cards.data.newAvailable} new
                </>
              ) : (
                'No decks yet'
              )
            }
            action={studyable > 0 ? 'Start studying' : 'Open flashcards'}
            onClick={() => (studyable > 0 ? startStudy() : setSection('flashcards'))}
          />
          <Stat
            icon={<Timer size={22} />}
            value={focusToday}
            label={focusToday === 1 ? 'focus session' : 'focus sessions'}
            detail="Completed today"
            action="Open the focus timer"
            onClick={() => setSection('focus')}
          />
        </div>

        {customizing && (
          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-raised px-5 py-3 text-[13px] text-muted" role="status">
            <LayoutDashboard size={16} className="shrink-0 text-accent-text" />
            <span className="flex-1">Arrange the page: reorder widgets, move them between the two columns, remove them, or add goals, your own pictures, and notes.</span>
          </div>
        )}

        {config && (
          <div className="grid grid-cols-1 gap-5 min-[1100px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            {(['main', 'side'] as const).map((column) => {
              const widgets = config.widgets.filter((widget) => widget.column === column)
              return (
                <div key={column} className="min-w-0 space-y-5" data-testid={`home-column-${column}`}>
                  {widgets.map((widget, position) => (
                    <div key={widget.id} data-testid="home-widget" data-widget={widget.type}>
                      {customizing && (
                        <WidgetControls
                          widget={widget}
                          first={position === 0}
                          last={position === widgets.length - 1}
                          onMove={(delta) => change((current) => moveWidget(current, widget.id, delta))}
                          onSwitch={() => change((current) => switchColumn(current, widget.id))}
                          onRemove={() => change((current) => removeWidget(current, widget.id))}
                        />
                      )}
                      {renderWidget(widget)}
                    </div>
                  ))}
                  {customizing && (
                    <ActionMenu items={addItems(column)}>
                      <Button className="h-10 w-full justify-center border-dashed text-[13px]" disabled={addableTypes(config).length === 0}>
                        <Plus size={15} />
                        Add a widget here
                      </Button>
                    </ActionMenu>
                  )}
                  {!customizing && widgets.length === 0 && column === 'main' && config.widgets.length === 0 && (
                    <p className="rounded-2xl border border-dashed border-line-strong px-5 py-8 text-center text-[13px] text-muted">This page is empty. Choose Customize to add widgets.</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
