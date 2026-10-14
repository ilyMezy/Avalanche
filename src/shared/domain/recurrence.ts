import type { Recurrence } from '../types'

// Reminder timing rules. Pure functions over local wall-clock dates and times, shared by the
// in-app scheduler today and intended for a headless Task Scheduler runner later.

function parts(date: string, time: string): [number, number, number, number, number] {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return [y, m, d, hh, mm]
}

/** Epoch milliseconds for a local calendar date and wall-clock time. */
export function localDateTimeToMs(date: string, time: string): number {
  const [y, m, d, hh, mm] = parts(date, time)
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime()
}

export function toLocalDateString(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function occurrence(date: string, time: string, recurrence: Recurrence, n: number): number {
  const [y, m, d, hh, mm] = parts(date, time)
  if (recurrence === 'daily') return new Date(y, m - 1, d + n, hh, mm).getTime()
  if (recurrence === 'weekly') return new Date(y, m - 1, d + 7 * n, hh, mm).getTime()
  if (recurrence === 'monthly') {
    // A reminder on the 31st falls on the last day of shorter months.
    const lastDay = new Date(y, m - 1 + n + 1, 0).getDate()
    return new Date(y, m - 1 + n, Math.min(d, lastDay), hh, mm).getTime()
  }
  return new Date(y, m - 1, d, hh, mm).getTime()
}

/**
 * The first occurrence strictly after `afterMs`, or null when a one-time reminder is already past.
 */
export function nextOccurrence(date: string, time: string, recurrence: Recurrence, afterMs: number): number | null {
  const first = occurrence(date, time, recurrence, 0)
  if (first > afterMs) return first
  if (recurrence === 'none') return null
  const stepDays = recurrence === 'daily' ? 1 : recurrence === 'weekly' ? 7 : 28
  let n = Math.max(1, Math.floor((afterMs - first) / (stepDays * 86_400_000)) - 1)
  for (let guard = 0; guard < 100; guard++, n++) {
    const candidate = occurrence(date, time, recurrence, n)
    if (candidate > afterMs) return candidate
  }
  return null
}

export interface FiringPlan {
  /** 'missed' when the occurrence came due more than `graceMs` before it could be delivered. */
  result: 'delivered' | 'missed'
  nextDueAt: number | null
  enabled: boolean
}

/** Decides what happens to a reminder whose `nextDueAt` has passed. */
export function planFiring(
  reminder: { localDate: string; localTime: string; recurrence: Recurrence; nextDueAt: number },
  nowMs: number,
  graceMs = 5 * 60_000
): FiringPlan {
  const result = nowMs - reminder.nextDueAt > graceMs ? 'missed' : 'delivered'
  const nextDueAt = nextOccurrence(reminder.localDate, reminder.localTime, reminder.recurrence, nowMs)
  return { result, nextDueAt, enabled: nextDueAt !== null }
}
