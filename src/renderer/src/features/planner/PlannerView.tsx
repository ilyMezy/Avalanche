import { Bell, BellOff, BellRing, CalendarCheck, Check, Info, Plus, Repeat, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Recurrence, Reminder, Task } from '@shared/types'
import { Button, IconButton } from '@/components/ui/button'
import { Field, Input, Segmented, Select, Textarea } from '@/components/ui/controls'
import { confirmDialog } from '@/components/ui/dialogs'
import { EmptyState, SectionHeader, Spinner, toast } from '@/components/ui/feedback'
import { call, errorMessage } from '@/lib/api'
import { invalidate, useData } from '@/lib/useData'
import { addDaysString, cn, formatDue, formatTimestamp, todayString } from '@/lib/utils'
import { PlannerCalendar } from './PlannerCalendar'

type Filter = 'today' | 'calendar' | 'upcoming' | 'all' | 'completed' | 'reminders'

const RECURRENCE_LABELS: Record<Recurrence, string> = { none: 'Does not repeat', daily: 'Every day', weekly: 'Every week', monthly: 'Every month' }

function reportError(error: unknown): void {
  toast(errorMessage(error), 'error')
}

/** Tasks sort by due date and time; tasks without a date come last. */
function byDue(a: Task, b: Task): number {
  const left = `${a.dueDate ?? '9999-99-99'} ${a.dueTime ?? '99:99'}`
  const right = `${b.dueDate ?? '9999-99-99'} ${b.dueTime ?? '99:99'}`
  return left.localeCompare(right) || a.createdAt - b.createdAt
}

function TaskRow({ task, selected, onSelect }: { task: Task; selected: boolean; onSelect(): void }): ReactNode {
  const done = task.completedAt !== null
  const overdue = !done && task.dueDate !== null && task.dueDate < todayString()
  const toggle = async (): Promise<void> => {
    await call('planner.setCompleted', { id: task.id, completed: !done }).catch(reportError)
    invalidate('planner')
  }
  return (
    <div
      data-testid="task-row"
      onClick={onSelect}
      className={cn('group flex min-h-10 cursor-default items-center gap-3 rounded-md px-3 py-1.5 transition-colors duration-75', selected ? 'bg-active' : 'hover:bg-hover')}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
        onClick={(event) => {
          event.stopPropagation()
          void toggle()
        }}
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors duration-100',
          done ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong hover:border-accent'
        )}
      >
        {done && <Check size={12} strokeWidth={3} />}
      </button>
      <span className={cn('min-w-0 flex-1 truncate text-[13px]', done ? 'text-subtle line-through' : 'text-fg')}>{task.title}</span>
      {task.reminder && (
        <span className={cn('flex items-center', task.reminder.missed ? 'text-warning' : 'text-subtle')} title={task.reminder.missed ? 'A reminder was missed while the app was closed' : 'Has a reminder'}>
          {task.reminder.recurrence !== 'none' ? <Repeat size={12} /> : <Bell size={12} />}
        </span>
      )}
      {task.dueDate && <span className={cn('shrink-0 text-xs', overdue ? 'text-danger' : 'text-muted')}>{formatDue(task.dueDate, task.dueTime)}</span>}
    </div>
  )
}

interface TaskForm {
  title: string
  notes: string
  dueDate: string
  dueTime: string
  remind: boolean
  reminderDate: string
  reminderTime: string
  recurrence: Recurrence
}

function toForm(task: Task): TaskForm {
  return {
    title: task.title,
    notes: task.notes,
    dueDate: task.dueDate ?? '',
    dueTime: task.dueTime ?? '',
    remind: task.reminder !== null,
    reminderDate: task.reminder?.localDate ?? task.dueDate ?? todayString(),
    reminderTime: task.reminder?.localTime ?? task.dueTime ?? '09:00',
    recurrence: task.reminder?.recurrence ?? 'none'
  }
}

function TaskDetail({ task, onClose }: { task: Task; onClose(): void }): ReactNode {
  const [form, setForm] = useState<TaskForm>(() => toForm(task))
  const [busy, setBusy] = useState(false)
  // The form follows the saved task only when its saved values actually change, so an unrelated
  // refresh of planner data does not throw away what is being typed.
  const savedForm = JSON.stringify(toForm(task))
  useEffect(() => setForm(JSON.parse(savedForm) as TaskForm), [savedForm])
  const set = (patch: Partial<TaskForm>): void => setForm((previous) => ({ ...previous, ...patch }))
  const dirty = JSON.stringify(form) !== savedForm

  const save = async (): Promise<void> => {
    if (!form.title.trim() || busy) return
    setBusy(true)
    try {
      await call('planner.saveTask', {
        id: task.id,
        title: form.title,
        notes: form.notes,
        dueDate: form.dueDate || null,
        dueTime: form.dueDate && form.dueTime ? form.dueTime : null,
        reminder: form.remind && form.reminderDate && form.reminderTime ? { localDate: form.reminderDate, localTime: form.reminderTime, recurrence: form.recurrence } : null
      })
      invalidate('planner')
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    const confirmed = await confirmDialog({
      title: `Delete “${task.title}”?`,
      body: 'The task and its reminder will be permanently deleted.',
      confirmLabel: 'Delete task',
      danger: true
    })
    if (!confirmed) return
    await call('planner.deleteTask', { id: task.id }).catch(reportError)
    invalidate('planner')
    onClose()
  }

  return (
    <aside aria-label="Task details" className="flex w-[340px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pr-2 pl-4">
        <span className="text-xs font-medium text-muted">Task details</span>
        <IconButton label="Close details" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-4">
        <Field label="Title">
          <Input value={form.title} onChange={(event) => set({ title: event.target.value })} aria-label="Task title" />
        </Field>
        <Field label="Notes">
          <Textarea rows={4} value={form.notes} onChange={(event) => set({ notes: event.target.value })} aria-label="Task notes" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Due date">
            <Input type="date" value={form.dueDate} onChange={(event) => set({ dueDate: event.target.value })} aria-label="Due date" />
          </Field>
          <Field label="Due time">
            <Input type="time" value={form.dueTime} disabled={!form.dueDate} onChange={(event) => set({ dueTime: event.target.value })} aria-label="Due time" />
          </Field>
        </div>

        <div className="rounded-lg border border-line p-3">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-fg">
            <input type="checkbox" checked={form.remind} onChange={(event) => set({ remind: event.target.checked })} className="accent-[var(--accent)]" />
            Remind me
          </label>
          {form.remind && (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" value={form.reminderDate} onChange={(event) => set({ reminderDate: event.target.value })} aria-label="Reminder date" />
                <Input type="time" value={form.reminderTime} onChange={(event) => set({ reminderTime: event.target.value })} aria-label="Reminder time" />
              </div>
              <Select value={form.recurrence} onChange={(event) => set({ recurrence: event.target.value as Recurrence })} aria-label="Repeat">
                {(Object.keys(RECURRENCE_LABELS) as Recurrence[]).map((value) => (
                  <option key={value} value={value}>
                    {RECURRENCE_LABELS[value]}
                  </option>
                ))}
              </Select>
              {task.reminder && (
                <p className="text-xs text-subtle">
                  {task.reminder.missed
                    ? 'The last reminder was missed because the app was not running.'
                    : task.reminder.nextDueAt
                      ? `Next reminder: ${formatTimestamp(task.reminder.nextDueAt)}`
                      : 'This reminder has already been delivered.'}
                </p>
              )}
            </div>
          )}
        </div>
        <p className="text-[11px] text-subtle">Created {formatTimestamp(task.createdAt)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line p-3">
        <Button variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => void remove()}>
          <Trash2 size={14} />
          Delete
        </Button>
        <span className="flex-1" />
        <Button variant="primary" disabled={!dirty || !form.title.trim() || busy} onClick={() => void save()}>
          Save changes
        </Button>
      </div>
    </aside>
  )
}

function ReminderHealth(): ReactNode {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2.5 text-xs leading-relaxed text-muted" role="note">
      <Info size={14} className="mt-0.5 shrink-0 text-accent-text" />
      <span>
        Reminders are delivered as Windows notifications <strong className="font-medium text-fg">while Avalanche is running</strong>. Delivery
        while the app is closed is not built yet; reminders that come due then are shown as missed the next time you open the app.
      </span>
    </div>
  )
}

function RemindersPanel({ reminders, tasks }: { reminders: Reminder[]; tasks: Task[] }): ReactNode {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayString())
  const [time, setTime] = useState('09:00')
  const [recurrence, setRecurrence] = useState<Recurrence>('none')
  const taskIds = new Set(tasks.map((task) => task.id))

  const add = async (): Promise<void> => {
    if (!title.trim()) return
    try {
      await call('planner.saveReminder', { title, localDate: date, localTime: time, recurrence })
      setTitle('')
      invalidate('planner')
    } catch (error) {
      reportError(error)
    }
  }
  const remove = async (reminder: Reminder): Promise<void> => {
    await call('planner.deleteReminder', { id: reminder.id }).catch(reportError)
    invalidate('planner')
  }
  const acknowledge = async (reminder: Reminder): Promise<void> => {
    await call('planner.acknowledgeReminder', { id: reminder.id }).catch(reportError)
    invalidate('planner')
  }

  return (
    <div className="space-y-4">
      <ReminderHealth />
      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <label className="min-w-[180px] flex-1">
          <span className="mb-1.5 block text-xs font-medium text-muted">New reminder</span>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Remind me to…" aria-label="Reminder title" />
        </label>
        <Input type="date" className="w-[140px]" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Reminder date" />
        <Input type="time" className="w-[110px]" value={time} onChange={(event) => setTime(event.target.value)} aria-label="Reminder time" />
        <Select className="w-[150px]" value={recurrence} onChange={(event) => setRecurrence(event.target.value as Recurrence)} aria-label="Repeat">
          {(Object.keys(RECURRENCE_LABELS) as Recurrence[]).map((value) => (
            <option key={value} value={value}>
              {RECURRENCE_LABELS[value]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary" disabled={!title.trim() || !date || !time}>
          <Plus size={14} />
          Add
        </Button>
      </form>

      {reminders.length === 0 ? (
        <EmptyState compact icon={<BellOff size={18} />} title="No reminders" body="Add a one-time or repeating reminder above, or turn on “Remind me” for a task." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          {reminders.map((reminder, index) => (
            <div key={reminder.id} data-testid="reminder-row" className={cn('flex min-h-11 items-center gap-3 px-3 py-1.5', index > 0 && 'border-t border-line')}>
              {reminder.missed ? <BellRing size={14} className="shrink-0 text-warning" /> : <Bell size={14} className={cn('shrink-0', reminder.enabled ? 'text-accent-text' : 'text-subtle')} />}
              <div className="min-w-0 flex-1">
                <div className={cn('truncate text-[13px]', reminder.enabled || reminder.missed ? 'text-fg' : 'text-subtle')}>{reminder.title}</div>
                <div className="text-xs text-muted">
                  {reminder.missed
                    ? 'Missed while the app was closed'
                    : reminder.nextDueAt
                      ? `Next: ${formatTimestamp(reminder.nextDueAt)}`
                      : reminder.lastFiredAt
                        ? `Delivered ${formatTimestamp(reminder.lastFiredAt)}`
                        : 'Not scheduled'}
                  {reminder.recurrence !== 'none' && ` · ${RECURRENCE_LABELS[reminder.recurrence]}`}
                  {reminder.taskId && taskIds.has(reminder.taskId) && ' · linked to a task'}
                </div>
              </div>
              {reminder.missed && (
                <Button size="sm" onClick={() => void acknowledge(reminder)}>
                  Dismiss
                </Button>
              )}
              {!reminder.taskId && (
                <IconButton label="Delete reminder" onClick={() => void remove(reminder)}>
                  <Trash2 size={14} />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Group({ label, tasks, selectedId, onSelect }: { label: string; tasks: Task[]; selectedId: string | null; onSelect(id: string): void }): ReactNode {
  if (tasks.length === 0) return null
  return (
    <section className="mb-4">
      <h2 className="mb-1 px-3 text-[10.5px] font-semibold tracking-wider text-subtle uppercase">{label}</h2>
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} selected={task.id === selectedId} onSelect={() => onSelect(task.id)} />
      ))}
    </section>
  )
}

export function PlannerView(): ReactNode {
  const [filter, setFilter] = useState<Filter>('today')
  const [quickTitle, setQuickTitle] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const tasks = useData<Task[]>(['planner'], () => call('planner.tasks'))
  const reminders = useData<Reminder[]>(['planner'], () => call('planner.reminders'))
  const today = todayString()

  const groups = useMemo(() => {
    const all = tasks.data ?? []
    const open = all.filter((task) => task.completedAt === null).sort(byDue)
    const done = all.filter((task) => task.completedAt !== null).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    const doneToday = done.filter((task) => new Date(task.completedAt!).toDateString() === new Date().toDateString())
    switch (filter) {
      case 'today':
        return [
          { label: 'Overdue', tasks: open.filter((task) => task.dueDate !== null && task.dueDate < today) },
          { label: 'Today', tasks: open.filter((task) => task.dueDate === today) },
          { label: 'Completed today', tasks: doneToday }
        ]
      case 'upcoming':
        return [
          { label: 'Tomorrow', tasks: open.filter((task) => task.dueDate === addDaysString(today, 1)) },
          { label: 'Later', tasks: open.filter((task) => task.dueDate !== null && task.dueDate > addDaysString(today, 1)) }
        ]
      case 'all':
        return [
          { label: 'Scheduled', tasks: open.filter((task) => task.dueDate !== null) },
          { label: 'No date', tasks: open.filter((task) => task.dueDate === null) }
        ]
      case 'completed':
        return [{ label: 'Completed', tasks: done }]
      default:
        return []
    }
  }, [tasks.data, filter, today])

  const selected = tasks.data?.find((task) => task.id === selectedId) ?? null
  const isEmpty = groups.every((group) => group.tasks.length === 0)

  const quickAdd = async (): Promise<void> => {
    const title = quickTitle.trim()
    if (!title) return
    try {
      const dueDate = filter === 'today' ? today : filter === 'upcoming' ? addDaysString(today, 1) : null
      const task = await call('planner.saveTask', { title, notes: '', dueDate, dueTime: null, reminder: null })
      setQuickTitle('')
      setSelectedId(task.id)
      invalidate('planner')
    } catch (error) {
      reportError(error)
    }
  }

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className={cn('mx-auto px-8 py-7', filter === 'calendar' ? 'max-w-[1080px]' : 'max-w-[760px]')}>
          <SectionHeader title="Planner" description="Tasks and reminders, stored on this computer.">
            <Segmented<Filter>
              label="Task filter"
              value={filter}
              onChange={(value) => {
                setFilter(value)
                setSelectedId(null)
              }}
              options={[
                { value: 'today', label: 'Today' },
                { value: 'calendar', label: 'Calendar' },
                { value: 'upcoming', label: 'Upcoming' },
                { value: 'all', label: 'All' },
                { value: 'completed', label: 'Completed' },
                { value: 'reminders', label: 'Reminders' }
              ]}
            />
          </SectionHeader>

          <div className="mt-5">
            {filter === 'calendar' ? (
              tasks.data === undefined ? (
                <Spinner />
              ) : (
                <PlannerCalendar
                  tasks={tasks.data}
                  reminders={reminders.data ?? []}
                  selectedTaskId={selectedId}
                  onSelectTask={setSelectedId}
                  renderTask={(task) => <TaskRow key={task.id} task={task} selected={task.id === selectedId} onSelect={() => setSelectedId(task.id)} />}
                />
              )
            ) : filter === 'reminders' ? (
              reminders.data === undefined ? (
                <Spinner />
              ) : (
                <RemindersPanel reminders={reminders.data} tasks={tasks.data ?? []} />
              )
            ) : (
              <>
                {filter !== 'completed' && (
                  <form
                    className="mb-5 flex items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void quickAdd()
                    }}
                  >
                    <div className="relative flex-1">
                      <Plus size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
                      <Input
                        aria-label="Add a task"
                        placeholder={filter === 'today' ? 'Add a task for today…' : filter === 'upcoming' ? 'Add a task for tomorrow…' : 'Add a task…'}
                        value={quickTitle}
                        onChange={(event) => setQuickTitle(event.target.value)}
                        className="h-9 pl-8"
                      />
                    </div>
                    <Button type="submit" variant="primary" className="h-9" disabled={!quickTitle.trim()}>
                      Add task
                    </Button>
                  </form>
                )}
                {tasks.data === undefined ? (
                  <div className="flex justify-center py-10">
                    <Spinner />
                  </div>
                ) : isEmpty ? (
                  <EmptyState
                    compact
                    icon={<CalendarCheck size={18} />}
                    title={filter === 'today' ? 'Nothing due today' : filter === 'upcoming' ? 'Nothing coming up' : filter === 'completed' ? 'No completed tasks yet' : 'No tasks yet'}
                    body={filter === 'completed' ? 'Tasks you tick off appear here.' : 'Type a task above and press Enter. Click a task to add a due time, notes, or a reminder.'}
                  />
                ) : (
                  groups.map((group) => <Group key={group.label} label={group.label} tasks={group.tasks} selectedId={selectedId} onSelect={setSelectedId} />)
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {selected && filter !== 'reminders' && <TaskDetail key={selected.id} task={selected} onClose={() => setSelectedId(null)} />}
    </div>
  )
}
