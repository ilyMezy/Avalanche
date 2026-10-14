// Month-grid arithmetic for the planner's calendar. Dates are local `YYYY-MM-DD` strings, the
// same form tasks and reminders are stored in, so nothing here depends on a time zone.

const pad = (value: number): string => String(value).padStart(2, '0')

export function dateString(year: number, monthIndex: number, day: number): string {
  // Normalizes overflow such as day 0 or month 12 through the Date constructor.
  const date = new Date(year, monthIndex, day)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export interface CalendarDay {
  date: string
  day: number
  /** False for the days of the neighbouring months that fill the first and last weeks. */
  inMonth: boolean
}

/**
 * The weeks shown for a month: whole weeks starting on `firstDayOfWeek` (0 = Sunday,
 * 1 = Monday, …), covering every day of the month.
 */
export function monthGrid(year: number, monthIndex: number, firstDayOfWeek: number): CalendarDay[][] {
  const first = new Date(year, monthIndex, 1)
  const lead = (first.getDay() - firstDayOfWeek + 7) % 7
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const weekCount = Math.ceil((lead + daysInMonth) / 7)
  const weeks: CalendarDay[][] = []
  for (let week = 0; week < weekCount; week++) {
    const row: CalendarDay[] = []
    for (let column = 0; column < 7; column++) {
      const date = new Date(year, monthIndex, 1 - lead + week * 7 + column)
      row.push({ date: dateString(date.getFullYear(), date.getMonth(), date.getDate()), day: date.getDate(), inMonth: date.getMonth() === first.getMonth() })
    }
    weeks.push(row)
  }
  return weeks
}

/** Short weekday names in display order, for the given locale and first day of the week. */
export function weekdayNames(firstDayOfWeek: number, locale?: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  // 4 January 1970 was a Sunday.
  return Array.from({ length: 7 }, (_, index) => format.format(new Date(1970, 0, 4 + ((firstDayOfWeek + index) % 7))))
}

/** Moves a `{ year, monthIndex }` pair by a number of months. */
export function shiftMonth(year: number, monthIndex: number, delta: number): { year: number; monthIndex: number } {
  const date = new Date(year, monthIndex + delta, 1)
  return { year: date.getFullYear(), monthIndex: date.getMonth() }
}

/** Groups items by their date string; items without a date are left out. */
export function groupByDate<T>(items: T[], dateOf: (item: T) => string | null | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items) {
    const date = dateOf(item)
    if (!date) continue
    const list = out.get(date)
    if (list) list.push(item)
    else out.set(date, [item])
  }
  return out
}
