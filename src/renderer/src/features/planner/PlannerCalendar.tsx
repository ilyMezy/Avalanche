import { Bell, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { dateString, groupByDate, monthGrid, shiftMonth, weekdayNames } from '@shared/domain/planner-calendar'
import type { Reminder, Task } from '@shared/types'
import { Button, IconButton } from '@/components/ui/button'
import { Input } from '@/components/ui/controls'
import { toast } from '@/components/ui/feedback'
import { call, errorMessage } from '@/lib/api'
import { invalidate } from '@/lib/useData'
import { cn, todayString } from '@/lib/utils'

const TASK_DRAG_TYPE = 'application/x-avalanche-task'
const MAX_CHIPS = 3

/** The first day of the week for the user's locale: 0 is Sunday. Monday when it is unknown. */
function localeFirstDay(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } }
    const first = locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay
    return typeof first === 'number' ? first % 7 : 1
  } catch {
    return 1
  }
}

const monthTitle = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const dayTitle = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const parse = (date: string): Date => {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** The date a reminder that is not tied to a task shows on: its next occurrence, else its set date. */
function reminderDate(reminder: Reminder): string {
  if (!reminder.nextDueAt) return reminder.localDate
  const next = new Date(reminder.nextDueAt)
  return dateString(next.getFullYear(), next.getMonth(), next.getDate())
}

/**
 * The planner as a month calendar. Tasks sit on their due dates and can be dragged to another
 * day; clicking a day lists what is on it and lets a task be added for that day.
 */
export function PlannerCalendar({
  tasks,
  reminders,
  selectedTaskId,
  onSelectTask,
  renderTask
}: {
  tasks: Task[]
  reminders: Reminder[]
  selectedTaskId: string | null
  onSelectTask(id: string): void
  /** Draws one task row in the day list, the same way the other planner views do. */
  renderTask(task: Task): ReactNode
}): ReactNode {
  const today = todayString()
  const [month, setMonth] = useState(() => ({ year: parse(today).getFullYear(), monthIndex: parse(today).getMonth() }))
  const [selectedDate, setSelectedDate] = useState(today)
  const [title, setTitle] = useState('')
  const [dropDate, setDropDate] = useState<string | null>(null)
  const firstDay = useMemo(localeFirstDay, [])
  const weeks = useMemo(() => monthGrid(month.year, month.monthIndex, firstDay), [month, firstDay])
  const names = useMemo(() => weekdayNames(firstDay), [firstDay])
  const tasksByDate = useMemo(() => groupByDate(tasks, (task) => task.dueDate), [tasks])
  const remindersByDate = useMemo(
    () =>
      groupByDate(
        reminders.filter((reminder) => !reminder.taskId && (reminder.enabled || reminder.missed)),
        reminderDate
      ),
    [reminders]
  )

  const goTo = (date: string): void => {
    const target = parse(date)
    setMonth({ year: target.getFullYear(), monthIndex: target.getMonth() })
    setSelectedDate(date)
  }

  const add = async (): Promise<void> => {
    const text = title.trim()
    if (!text) return
    try {
      const task = await call('planner.saveTask', { title: text, notes: '', dueDate: selectedDate, dueTime: null, reminder: null })
      setTitle('')
      invalidate('planner')
      onSelectTask(task.id)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const moveTask = async (id: string, date: string): Promise<void> => {
    const task = tasks.find((candidate) => candidate.id === id)
    if (!task || task.dueDate === date) return
    try {
      await call('planner.saveTask', {
        id: task.id,
        title: task.title,
        notes: task.notes,
        dueDate: date,
        dueTime: task.dueTime,
        // A reminder set for the old due date moves with the task; any other reminder is kept as it is.
        reminder: task.reminder
          ? { localDate: task.reminder.localDate === task.dueDate ? date : task.reminder.localDate, localTime: task.reminder.localTime, recurrence: task.reminder.recurrence }
          : null
      })
      invalidate('planner')
      setSelectedDate(date)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const dayTasks = (tasksByDate.get(selectedDate) ?? []).slice().sort((a, b) => (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') || a.createdAt - b.createdAt)
  const dayReminders = remindersByDate.get(selectedDate) ?? []

  return (
    <div data-testid="planner-calendar">
      <div className="mb-3 flex items-center gap-1">
        <h2 className="flex-1 text-[15px] font-semibold tracking-tight text-fg" data-testid="calendar-month">
          {monthTitle.format(new Date(month.year, month.monthIndex, 1))}
        </h2>
        <Button size="sm" onClick={() => goTo(today)}>
          Today
        </Button>
        <IconButton label="Previous month" onClick={() => setMonth(shiftMonth(month.year, month.monthIndex, -1))}>
          <ChevronLeft size={16} />
        </IconButton>
        <IconButton label="Next month" onClick={() => setMonth(shiftMonth(month.year, month.monthIndex, 1))}>
          <ChevronRight size={16} />
        </IconButton>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface" role="grid" aria-label={monthTitle.format(new Date(month.year, month.monthIndex, 1))}>
        <div className="grid grid-cols-7 border-b border-line" role="row">
          {names.map((name) => (
            <div key={name} role="columnheader" className="px-2 py-1.5 text-[11px] font-medium tracking-wide text-subtle uppercase">
              {name}
            </div>
          ))}
        </div>
        {weeks.map((week, weekIndex) => (
          <div key={week[0].date} className={cn('grid grid-cols-7', weekIndex > 0 && 'border-t border-line')} role="row">
            {week.map((day, column) => {
              const items = tasksByDate.get(day.date) ?? []
              const bells = remindersByDate.get(day.date) ?? []
              const open = items.filter((task) => task.completedAt === null)
              const shown = [...open, ...items.filter((task) => task.completedAt !== null)].slice(0, MAX_CHIPS)
              const hidden = items.length - shown.length
              const isToday = day.date === today
              const isSelected = day.date === selectedDate
              return (
                <div
                  key={day.date}
                  role="gridcell"
                  aria-selected={isSelected}
                  aria-label={`${dayTitle.format(parse(day.date))}${items.length ? `, ${items.length} ${items.length === 1 ? 'task' : 'tasks'}` : ''}`}
                  data-date={day.date}
                  data-testid="calendar-day"
                  onClick={() => setSelectedDate(day.date)}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(TASK_DRAG_TYPE)) return
                    event.preventDefault()
                    setDropDate(day.date)
                  }}
                  onDragLeave={() => setDropDate((value) => (value === day.date ? null : value))}
                  onDrop={(event) => {
                    event.preventDefault()
                    setDropDate(null)
                    void moveTask(event.dataTransfer.getData(TASK_DRAG_TYPE), day.date)
                  }}
                  className={cn(
                    'min-h-[92px] cursor-default p-1.5 transition-colors duration-75',
                    column > 0 && 'border-l border-line',
                    !day.inMonth && 'bg-bg/60',
                    isSelected ? 'bg-accent-soft' : 'hover:bg-hover',
                    dropDate === day.date && 'ring-2 ring-accent ring-inset'
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={cn(
                        'flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-xs tabular-nums',
                        isToday ? 'bg-accent font-semibold text-accent-fg' : day.inMonth ? 'text-fg' : 'text-subtle'
                      )}
                    >
                      {day.day}
                    </span>
                    {bells.length > 0 && <Bell size={11} className="text-accent-text" aria-label={`${bells.length} ${bells.length === 1 ? 'reminder' : 'reminders'}`} />}
                  </div>
                  {shown.map((task) => {
                    const done = task.completedAt !== null
                    const overdue = !done && day.date < today
                    return (
                      <button
                        key={task.id}
                        type="button"
                        draggable
                        data-testid="calendar-task"
                        title={task.title}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(TASK_DRAG_TYPE, task.id)
                          event.dataTransfer.effectAllowed = 'move'
                        }}
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedDate(day.date)
                          onSelectTask(task.id)
                        }}
                        className={cn(
                          'mb-0.5 block w-full truncate rounded-[5px] border-l-2 px-1.5 py-px text-left text-[11.5px] leading-[18px]',
                          done ? 'border-line-strong bg-hover text-subtle line-through' : overdue ? 'border-danger bg-danger-soft text-fg' : 'border-accent bg-raised text-fg',
                          task.id === selectedTaskId && 'ring-1 ring-accent'
                        )}
                      >
                        {task.dueTime && <span className="mr-1 text-subtle tabular-nums">{task.dueTime}</span>}
                        {task.title}
                      </button>
                    )
                  })}
                  {hidden > 0 && <div className="px-1.5 text-[11px] text-subtle">+{hidden} more</div>}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <section className="mt-5" aria-label="Selected day">
        <h3 className="mb-2 text-[13px] font-semibold text-fg" data-testid="calendar-selected-day">
          {dayTitle.format(parse(selectedDate))}
          {selectedDate === today && <span className="ml-2 text-xs font-normal text-accent-text">Today</span>}
        </h3>
        <form
          className="mb-3 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void add()
          }}
        >
          <div className="relative flex-1">
            <Plus size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
            <Input aria-label="Add a task for the selected day" placeholder="Add a task for this day…" value={title} onChange={(event) => setTitle(event.target.value)} className="h-9 pl-8" />
          </div>
          <Button type="submit" variant="primary" className="h-9" disabled={!title.trim()}>
            Add task
          </Button>
        </form>
        {dayTasks.map((task) => renderTask(task))}
        {dayReminders.map((reminder) => (
          <div key={reminder.id} className="flex min-h-9 items-center gap-3 px-3 text-[13px] text-fg">
            <Bell size={14} className="shrink-0 text-accent-text" />
            <span className="min-w-0 flex-1 truncate">{reminder.title}</span>
            <span className="text-xs text-muted tabular-nums">{reminder.localTime}</span>
          </div>
        ))}
        {dayTasks.length === 0 && dayReminders.length === 0 && <p className="px-3 py-2 text-xs text-subtle">Nothing on this day. Drag a task here from another day, or add one above.</p>}
      </section>
    </div>
  )
}
