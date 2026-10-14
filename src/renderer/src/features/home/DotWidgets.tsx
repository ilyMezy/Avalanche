import { Pause, Play } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { daysUntil, updateWidget, yearProgress, type HomeConfig, type HomeWidget } from '@shared/domain/home'
import { groupByDate, monthGrid, weekdayNames } from '@shared/domain/planner-calendar'
import { formatClock, MODE_LABELS, remainingMs } from '@shared/domain/pomodoro'
import type { Task } from '@shared/types'
import { useAppStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/controls'
import { pomodoro, usePomodoro } from '@/features/pomodoro/controller'
import { cn, longDate, todayString } from '@/lib/utils'

// Glanceable widgets drawn in a dot-matrix style: lit dots in the text colour, unlit dots faint.
// The numerals are a 5 × 7 matrix drawn as SVG, so no font is downloaded or bundled.

const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ':': ['0', '0', '1', '0', '1', '0', '0'],
  '-': ['000', '000', '000', '111', '000', '000', '000'],
  ' ': ['00', '00', '00', '00', '00', '00', '00']
}

/** Digits (and ":" and "-") as a dot matrix. `dot` is the pitch of one dot in pixels. */
export function DotText({ text, dot = 7, className, label }: { text: string; dot?: number; className?: string; label?: string }): ReactNode {
  const cells: { x: number; y: number; lit: boolean }[] = []
  let column = 0
  for (const char of text) {
    const glyph = GLYPHS[char] ?? GLYPHS[' ']
    for (let row = 0; row < 7; row++) for (let x = 0; x < glyph[row].length; x++) cells.push({ x: column + x, y: row, lit: glyph[row][x] === '1' })
    column += glyph[0].length + 1
  }
  const width = Math.max(1, column - 1)
  return (
    <svg role="img" aria-label={label ?? text} width={width * dot} height={7 * dot} viewBox={`0 0 ${width} 7`} className={className} data-testid="dot-text" data-text={text}>
      {cells.map((cell, index) => (
        <circle key={index} cx={cell.x + 0.5} cy={cell.y + 0.5} r={0.36} fill="currentColor" opacity={cell.lit ? 1 : 0.12} />
      ))}
    </svg>
  )
}

function Card({ label, children, className }: { label: string; children: ReactNode; className?: string }): ReactNode {
  return (
    <section aria-label={label} className={cn('rounded-2xl border border-line bg-surface p-5', className)}>
      {children}
    </section>
  )
}

const Caption = ({ children }: { children: ReactNode }): ReactNode => <div className="text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">{children}</div>

/** Re-renders at the start of every minute. */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = (): void => {
      timer = setTimeout(
        () => {
          setNow(new Date())
          schedule()
        },
        60_000 - (Date.now() % 60_000) + 50
      )
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])
  return now
}

export function ClockWidget(): ReactNode {
  const now = useMinute()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return (
    <Card label="Clock" className="flex flex-col items-start gap-3">
      <Caption>Now</Caption>
      <DotText text={time} dot={9} className="max-w-full text-fg" label={`The time is ${time}`} />
      <div className="text-[13px] text-muted">{longDate.format(now)}</div>
    </Card>
  )
}

export function YearWidget(): ReactNode {
  useMinute()
  const { day, total, percent } = yearProgress(todayString())
  // Seventy-three columns of five: one dot for every day of an ordinary year.
  const columns = Math.ceil(total / 5)
  return (
    <Card label="Year progress">
      <div className="flex items-end justify-between">
        <Caption>{todayString().slice(0, 4)}</Caption>
        <span className="text-[13px] text-muted tabular-nums" data-testid="year-progress">
          Day {day} of {total} · {percent}%
        </span>
      </div>
      <svg viewBox={`0 0 ${columns} 5`} className="mt-3 w-full text-fg" role="img" aria-label={`${percent}% of the year has passed`}>
        {Array.from({ length: total }, (_, index) => (
          <circle key={index} cx={Math.floor(index / 5) + 0.5} cy={(index % 5) + 0.5} r={0.33} fill="currentColor" opacity={index < day ? 1 : 0.14} />
        ))}
      </svg>
    </Card>
  )
}

/** Days until (or since) a date the user chose, such as an exam or a deadline. */
export function CountdownWidget({ widget, editing, change }: { widget: HomeWidget; editing: boolean; change(update: (current: HomeConfig) => HomeConfig): void }): ReactNode {
  useMinute()
  const days = daysUntil(widget.text, todayString())
  const title = widget.title || 'Countdown'
  return (
    <Card label={title} className="flex flex-col items-start gap-3">
      <Caption>{title}</Caption>
      {days === null ? (
        <p className="text-[13px] text-muted">Choose the date to count down to.</p>
      ) : (
        <>
          <DotText text={String(Math.abs(days))} dot={10} className="max-w-full text-accent-text" label={`${Math.abs(days)} days`} />
          <div className="text-[13px] text-muted" data-testid="countdown-label">
            {days === 0 ? 'Today' : `${Math.abs(days) === 1 ? 'day' : 'days'} ${days > 0 ? 'to go' : 'ago'}`}
          </div>
        </>
      )}
      {(editing || days === null) && (
        <div className="flex w-full items-center gap-2 border-t border-line pt-3">
          <Input aria-label="Countdown name" placeholder="What for?" value={widget.title} maxLength={120} onChange={(event) => change((current) => updateWidget(current, widget.id, { title: event.target.value }))} className="h-8 min-w-0 flex-1 text-[13px]" />
          <Input aria-label="Countdown date" type="date" value={widget.text} onChange={(event) => change((current) => updateWidget(current, widget.id, { text: event.target.value }))} className="h-8 w-[150px] text-[13px]" />
        </div>
      )}
    </Card>
  )
}

/** The Pomodoro timer at a glance, with start and pause. */
export function FocusWidget(): ReactNode {
  const { ready, state, now } = usePomodoro()
  if (!ready) return null
  const running = state.status === 'running'
  const clock = formatClock(remainingMs(state, now))
  return (
    <Card label="Focus timer" className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <Caption>
          {MODE_LABELS[state.mode]} · {running ? 'running' : state.status === 'paused' ? 'paused' : 'ready'}
        </Caption>
        <DotText text={clock} dot={8} className="mt-3 max-w-full text-fg" label={`${clock} left`} />
      </div>
      <Button variant="primary" className="h-11 w-11 shrink-0 justify-center rounded-full p-0" aria-label={running ? 'Pause the focus timer' : 'Start the focus timer'} onClick={pomodoro.toggle}>
        {running ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </Button>
    </Card>
  )
}

/** This month at a glance: a dot under each day that has a task due. Opens the planner. */
export function MiniCalendarWidget({ tasks }: { tasks: Task[] }): ReactNode {
  useMinute()
  const today = todayString()
  const [year, month] = today.split('-').map(Number)
  const weeks = useMemo(() => monthGrid(year, month - 1, 1), [year, month])
  const names = useMemo(() => weekdayNames(1), [])
  const due = useMemo(
    () =>
      groupByDate(
        tasks.filter((task) => task.completedAt === null),
        (task) => task.dueDate
      ),
    [tasks]
  )
  return (
    <Card label="This month">
      <button type="button" className="mb-2 flex w-full items-center justify-between text-left" onClick={() => useAppStore.getState().setSection('planner')}>
        <Caption>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1))}</Caption>
        <span className="text-[12px] text-muted hover:text-fg">Planner</span>
      </button>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {names.map((name) => (
          <div key={name} className="text-[10.5px] text-subtle uppercase">
            {name.slice(0, 2)}
          </div>
        ))}
        {weeks.flat().map((day) => (
          <div key={day.date} className="flex flex-col items-center" title={due.has(day.date) ? `${due.get(day.date)!.length} due` : undefined}>
            <span
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-[12.5px] tabular-nums',
                day.date === today ? 'bg-accent font-semibold text-accent-fg' : day.inMonth ? 'text-fg' : 'text-subtle opacity-50'
              )}
            >
              {day.day}
            </span>
            <span className={cn('h-1 w-1 rounded-full', due.has(day.date) ? (day.date < today ? 'bg-danger' : 'bg-accent') : 'bg-transparent')} />
          </div>
        ))}
      </div>
    </Card>
  )
}
