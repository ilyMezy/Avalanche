import { uuidv7 } from './uuid'

// What the Home page shows and in which order. The page is two columns of widgets: some are
// built in (recent documents, today's tasks, …) and can appear once; goals, pictures, and notes
// are the user's own. Goals are stored here too, since they belong to the Home page.

export const WIDGET_TYPES = ['recentDocuments', 'folders', 'today', 'reminders', 'recentNotes', 'goals', 'image', 'text', 'clock', 'countdown', 'focus', 'calendar', 'yearProgress'] as const
export type WidgetType = (typeof WIDGET_TYPES)[number]
export type HomeColumn = 'main' | 'side'

export const WIDGET_LABELS: Record<WidgetType, string> = {
  recentDocuments: 'Recent documents',
  folders: 'Folders',
  today: 'Today',
  reminders: 'Reminders',
  recentNotes: 'Recent quick notes',
  goals: 'Goals',
  image: 'Picture',
  text: 'Note',
  clock: 'Clock',
  countdown: 'Countdown',
  focus: 'Focus timer',
  calendar: 'Mini calendar',
  yearProgress: 'Year progress'
}

/** Widgets that may be added more than once. Every other type appears at most once. */
export const REPEATABLE: readonly WidgetType[] = ['image', 'text', 'countdown']

export const MAX_WIDGETS = 24
export const MAX_GOALS = 50
export const MAX_GOAL_TARGET = 9999
/** File name of a stored Home picture: an id plus one of the accepted extensions. */
export const HOME_IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|gif|webp)$/

export interface HomeWidget {
  id: string
  type: WidgetType
  column: HomeColumn
  /** Picture widgets: the stored picture's id, or null until one is chosen. */
  imageId: string | null
  /** Picture caption, or the heading of a note. */
  title: string
  /** The body of a note, or a countdown's date as `YYYY-MM-DD`. */
  text: string
}

export interface Goal {
  id: string
  title: string
  done: boolean
  /** 0 for a goal that is simply done or not; otherwise how many steps it takes. */
  target: number
  progress: number
}

export interface HomeConfig {
  widgets: HomeWidget[]
  goals: Goal[]
  /** A picture of the user's own behind the greeting at the top of Home, or null for the ridgeline. */
  heroImage: string | null
}

export function newWidget(type: WidgetType, column: HomeColumn): HomeWidget {
  return { id: uuidv7(), type, column, imageId: null, title: type === 'text' ? 'Note' : '', text: '' }
}

export function defaultHome(): HomeConfig {
  return {
    widgets: [newWidget('recentDocuments', 'main'), newWidget('folders', 'main'), newWidget('goals', 'side'), newWidget('today', 'side'), newWidget('reminders', 'side'), newWidget('recentNotes', 'side')],
    goals: [],
    heroImage: null
  }
}

/** The types that can still be added: repeatable ones always, the others only while absent. */
export function addableTypes(config: HomeConfig): WidgetType[] {
  if (config.widgets.length >= MAX_WIDGETS) return []
  const present = new Set(config.widgets.map((widget) => widget.type))
  return WIDGET_TYPES.filter((type) => REPEATABLE.includes(type) || !present.has(type))
}

export function addWidget(config: HomeConfig, type: WidgetType, column: HomeColumn): HomeConfig {
  if (!addableTypes(config).includes(type)) return config
  return { ...config, widgets: [...config.widgets, newWidget(type, column)] }
}

export function removeWidget(config: HomeConfig, id: string): HomeConfig {
  return { ...config, widgets: config.widgets.filter((widget) => widget.id !== id) }
}

export function updateWidget(config: HomeConfig, id: string, patch: Partial<Pick<HomeWidget, 'imageId' | 'title' | 'text'>>): HomeConfig {
  return { ...config, widgets: config.widgets.map((widget) => (widget.id === id ? { ...widget, ...patch } : widget)) }
}

/** Moves a widget one place up or down within its own column. */
export function moveWidget(config: HomeConfig, id: string, delta: -1 | 1): HomeConfig {
  const widget = config.widgets.find((candidate) => candidate.id === id)
  if (!widget) return config
  const column = config.widgets.filter((candidate) => candidate.column === widget.column)
  const at = column.indexOf(widget)
  const other = column[at + delta]
  if (!other) return config
  const widgets = [...config.widgets]
  const a = widgets.indexOf(widget)
  const b = widgets.indexOf(other)
  widgets[a] = other
  widgets[b] = widget
  return { ...config, widgets }
}

/** Sends a widget to the end of the other column. */
export function switchColumn(config: HomeConfig, id: string): HomeConfig {
  const widget = config.widgets.find((candidate) => candidate.id === id)
  if (!widget) return config
  const moved: HomeWidget = { ...widget, column: widget.column === 'main' ? 'side' : 'main' }
  return { ...config, widgets: [...config.widgets.filter((candidate) => candidate.id !== id), moved] }
}

export function addGoal(config: HomeConfig, title: string, target = 0): HomeConfig {
  const text = title.trim().slice(0, 200)
  if (!text || config.goals.length >= MAX_GOALS) return config
  const steps = Math.max(0, Math.min(MAX_GOAL_TARGET, Math.round(target) || 0))
  return { ...config, goals: [...config.goals, { id: uuidv7(), title: text, done: false, target: steps, progress: 0 }] }
}

/** Ticks a simple goal, or completes or reopens a counted one. */
export function toggleGoal(config: HomeConfig, id: string): HomeConfig {
  return {
    ...config,
    goals: config.goals.map((goal) => {
      if (goal.id !== id) return goal
      const done = !goal.done
      return { ...goal, done, progress: goal.target > 0 ? (done ? goal.target : Math.min(goal.progress, goal.target - 1)) : goal.progress }
    })
  }
}

/** Adds to a counted goal's progress; reaching the target completes it. */
export function stepGoal(config: HomeConfig, id: string, delta: number): HomeConfig {
  return {
    ...config,
    goals: config.goals.map((goal) => {
      if (goal.id !== id || goal.target <= 0) return goal
      const progress = Math.max(0, Math.min(goal.target, goal.progress + delta))
      return { ...goal, progress, done: progress >= goal.target }
    })
  }
}

export function removeGoal(config: HomeConfig, id: string): HomeConfig {
  return { ...config, goals: config.goals.filter((goal) => goal.id !== id) }
}

/** The ids of every stored picture the layout still uses. */
export function usedImages(config: HomeConfig): Set<string> {
  const ids = new Set(config.widgets.map((widget) => widget.imageId).filter((id): id is string => id !== null))
  if (config.heroImage) ids.add(config.heroImage)
  return ids
}

/**
 * Makes a stored layout safe to use: unknown widget types and duplicates of once-only widgets
 * are dropped, counts are clamped, and anything unreadable falls back to the default layout.
 */
export function normalizeHome(value: unknown): HomeConfig {
  if (!value || typeof value !== 'object') return defaultHome()
  const raw = value as { widgets?: unknown; goals?: unknown; heroImage?: unknown }
  if (!Array.isArray(raw.widgets)) return defaultHome()
  const seen = new Set<string>()
  const once = new Set<WidgetType>()
  const widgets: HomeWidget[] = []
  for (const item of raw.widgets as Partial<HomeWidget>[]) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || seen.has(item.id)) continue
    if (!WIDGET_TYPES.includes(item.type as WidgetType)) continue
    const type = item.type as WidgetType
    if (!REPEATABLE.includes(type)) {
      if (once.has(type)) continue
      once.add(type)
    }
    seen.add(item.id)
    widgets.push({
      id: item.id.slice(0, 64),
      type,
      column: item.column === 'side' ? 'side' : 'main',
      imageId: typeof item.imageId === 'string' && HOME_IMAGE_ID.test(item.imageId) ? item.imageId : null,
      title: typeof item.title === 'string' ? item.title.slice(0, 120) : '',
      text: typeof item.text === 'string' ? item.text.slice(0, 4000) : ''
    })
    if (widgets.length >= MAX_WIDGETS) break
  }
  const goals: Goal[] = []
  for (const item of (Array.isArray(raw.goals) ? raw.goals : []) as Partial<Goal>[]) {
    if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || !item.title.trim()) continue
    const target = Math.max(0, Math.min(MAX_GOAL_TARGET, Math.round(Number(item.target)) || 0))
    const progress = Math.max(0, Math.min(target, Math.round(Number(item.progress)) || 0))
    goals.push({ id: item.id.slice(0, 64), title: item.title.trim().slice(0, 200), done: target > 0 ? progress >= target : item.done === true, target, progress })
    if (goals.length >= MAX_GOALS) break
  }
  const heroImage = typeof (raw as { heroImage?: unknown }).heroImage === 'string' && HOME_IMAGE_ID.test((raw as { heroImage: string }).heroImage) ? (raw as { heroImage: string }).heroImage : null
  return { widgets, goals, heroImage }
}

const DAY_MS = 86_400_000
const utcDay = (date: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const check = new Date(time)
  return check.getUTCMonth() === Number(match[2]) - 1 && check.getUTCDate() === Number(match[3]) ? time : null
}

/** Whole days from `today` to `date` (negative once it has passed), or null for a missing or invalid date. */
export function daysUntil(date: string, today: string): number | null {
  const target = utcDay(date)
  const from = utcDay(today)
  return target === null || from === null ? null : Math.round((target - from) / DAY_MS)
}

/** Which day of the year `today` is, out of how many, and the share that has passed. */
export function yearProgress(today: string): { day: number; total: number; percent: number } {
  const year = Number(today.slice(0, 4))
  const start = Date.UTC(year, 0, 1)
  const total = Math.round((Date.UTC(year + 1, 0, 1) - start) / DAY_MS)
  const day = Math.min(total, Math.max(1, Math.round(((utcDay(today) ?? start) - start) / DAY_MS) + 1))
  return { day, total, percent: Math.round((day / total) * 100) }
}
