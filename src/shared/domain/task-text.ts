// Turning text selected in a document into a planner task: the first line becomes the title,
// the rest the notes, and a date or time written in the text is offered as the due date. The
// suggestion is only a starting point; the user confirms or changes it before anything is saved.

export interface TaskDraft {
  title: string
  notes: string
  dueDate: string | null
  dueTime: string | null
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const pad = (value: number): string => String(value).padStart(2, '0')
const iso = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const valid = (year: number, month: number, day: number): boolean => {
  const date = new Date(year, month, day)
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
}

/** A date mentioned in the text, as `YYYY-MM-DD`, relative to `today` (also `YYYY-MM-DD`). */
export function findDate(text: string, today: string): string | null {
  const [y, m, d] = today.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  const lower = text.toLowerCase()

  const explicit = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(lower)
  if (explicit && valid(Number(explicit[1]), Number(explicit[2]) - 1, Number(explicit[3]))) return explicit[0]

  if (/\btomorrow\b/.test(lower)) return iso(new Date(y, m - 1, d + 1))
  if (/\b(today|tonight)\b/.test(lower)) return today

  const month = MONTHS.map((name) => `${name}|${name.slice(0, 3)}`).join('|')
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?: of)? (${month})\\.?(?:,? (\\d{4}))?\\b`).exec(lower)
  const monthDay = new RegExp(`\\b(${month})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b`).exec(lower)
  const named = dayMonth ? { day: Number(dayMonth[1]), month: dayMonth[2], year: dayMonth[3] } : monthDay ? { day: Number(monthDay[2]), month: monthDay[1], year: monthDay[3] } : null
  if (named) {
    const monthIndex = MONTHS.findIndex((name) => name.startsWith(named.month.slice(0, 3)))
    let year = named.year ? Number(named.year) : y
    // Without a year, a date that has already passed this year means next year.
    if (!named.year && valid(year, monthIndex, named.day) && new Date(year, monthIndex, named.day) < base) year++
    if (valid(year, monthIndex, named.day)) return iso(new Date(year, monthIndex, named.day))
  }

  const weekday = new RegExp(`\\b(${WEEKDAYS.join('|')})\\b`).exec(lower)
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1])
    // The coming occurrence; "Friday" said on a Friday means a week from now.
    const ahead = (target - base.getDay() + 7) % 7 || 7
    return iso(new Date(y, m - 1, d + ahead))
  }

  const inDays = /\bin (\d{1,3}) (day|week)s?\b/.exec(lower)
  if (inDays) return iso(new Date(y, m - 1, d + Number(inDays[1]) * (inDays[2] === 'week' ? 7 : 1)))
  if (/\bnext week\b/.test(lower)) return iso(new Date(y, m - 1, d + 7))
  return null
}

/** A time of day mentioned in the text, as `HH:MM`. */
export function findTime(text: string): string | null {
  const lower = text.toLowerCase()
  const twelve = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)/.exec(lower)
  if (twelve) {
    const hour = (Number(twelve[1]) % 12) + (twelve[3].startsWith('p') ? 12 : 0)
    return `${pad(hour)}:${twelve[2] ?? '00'}`
  }
  const twentyFour = /\b(?:at|by|@)\s*([01]?\d|2[0-3]):([0-5]\d)\b/.exec(lower)
  if (twentyFour) return `${pad(Number(twentyFour[1]))}:${twentyFour[2]}`
  if (/\bnoon\b/.test(lower)) return '12:00'
  return null
}

export function taskFromText(text: string, today: string): TaskDraft {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
  const first = lines.findIndex((line) => line !== '')
  // List markers, checkboxes, and heading marks at the start of the line are not part of the title.
  const title = (lines[first] ?? '')
    .replace(/^(?:[-*+•]|\d+[.)])\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/^#{1,6}\s+/, '')
    .slice(0, 200)
  const notes = lines
    .slice(first + 1)
    .join('\n')
    .trim()
    .slice(0, 4000)
  const dueDate = findDate(text, today)
  return { title, notes, dueDate, dueTime: dueDate ? findTime(text) : null }
}
