import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** The workspace folder's own name, shown as the workspace identity. */
export function workspaceName(path: string | undefined): string {
  if (!path) return 'Workspace'
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function todayString(): string {
  return toDateString(new Date())
}

export function addDaysString(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return toDateString(new Date(y, m - 1, d + days))
}

const dayMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const dayMonthYear = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const weekdayDayMonth = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
export const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/** "Just now", "12 min ago", "Today 14:05", "Yesterday 09:10", "3 Oct", "3 Oct 2025". */
export function formatTimestamp(ms: number): string {
  const date = new Date(ms)
  const diff = Date.now() - ms
  if (diff >= 0 && diff < 60_000) return 'Just now'
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  const day = toDateString(date)
  const today = todayString()
  if (day === today) return `Today ${timeOnly.format(date)}`
  if (day === addDaysString(today, -1)) return `Yesterday ${timeOnly.format(date)}`
  return date.getFullYear() === new Date().getFullYear() ? dayMonth.format(date) : dayMonthYear.format(date)
}

/** "Today", "Tomorrow", "Yesterday", or "Mon 12 Oct", followed by the time when there is one. */
export function formatDue(date: string, time: string | null): string {
  const today = todayString()
  const [y, m, d] = date.split('-').map(Number)
  const label =
    date === today
      ? 'Today'
      : date === addDaysString(today, 1)
        ? 'Tomorrow'
        : date === addDaysString(today, -1)
          ? 'Yesterday'
          : weekdayDayMonth.format(new Date(y, m - 1, d))
  return time ? `${label} ${time}` : label
}

export function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function plural(count: number, noun: string, pluralForm = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralForm}`
}
