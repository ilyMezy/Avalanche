// Pomodoro timer logic as pure functions of (state, settings, now).
//
// Timing model: a running session stores the wall-clock instant it ends (`endsAt`). Remaining
// time is always computed as `endsAt - now`, never by counting ticks, so the timer cannot
// drift with UI re-renders, keeps correct time while the window is in the background, and can
// be recovered after the app restarts or the computer sleeps. A paused or idle session stores
// `remainingMs` instead.

export type PomodoroMode = 'focus' | 'short' | 'long'
export type PomodoroStatus = 'idle' | 'running' | 'paused'

export interface PomodoroSettings {
  focusMinutes: number
  shortMinutes: number
  longMinutes: number
  /** A long break follows every Nth focus session. */
  longEvery: number
  /** Start the next session automatically when one ends. */
  autoStart: boolean
  sound: boolean
  notify: boolean
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  focusMinutes: 25,
  shortMinutes: 5,
  longMinutes: 15,
  longEvery: 4,
  autoStart: false,
  sound: true,
  notify: true
}

export interface PomodoroState {
  mode: PomodoroMode
  status: PomodoroStatus
  /** Wall-clock ms when the current session first started; null while idle. */
  startedAt: number | null
  /** Wall-clock ms when the running session ends; null unless running. */
  endsAt: number | null
  /** Time left when not running. */
  remainingMs: number
  /** Focus sessions completed since the last long break. */
  focusStreak: number
}

export interface FinishedSession {
  mode: PomodoroMode
  startedAt: number
  endedAt: number
  plannedMs: number
  /** False when the session was skipped before its planned end. */
  completed: boolean
}

export const MODE_LABELS: Record<PomodoroMode, string> = { focus: 'Focus', short: 'Short break', long: 'Long break' }

/** A session that ended longer ago than this is treated as over; the next one is not auto-started. */
const AUTO_START_GRACE_MS = 60_000

export function durationMs(mode: PomodoroMode, settings: PomodoroSettings): number {
  const minutes = mode === 'focus' ? settings.focusMinutes : mode === 'short' ? settings.shortMinutes : settings.longMinutes
  return Math.round(minutes * 60_000)
}

export function initialState(settings: PomodoroSettings, mode: PomodoroMode = 'focus', focusStreak = 0): PomodoroState {
  return { mode, status: 'idle', startedAt: null, endsAt: null, remainingMs: durationMs(mode, settings), focusStreak }
}

export function remainingMs(state: PomodoroState, now: number): number {
  return state.status === 'running' && state.endsAt !== null ? Math.max(0, state.endsAt - now) : state.remainingMs
}

/** Starts an idle session or resumes a paused one. */
export function start(state: PomodoroState, now: number): PomodoroState {
  if (state.status === 'running') return state
  return { ...state, status: 'running', startedAt: state.startedAt ?? now, endsAt: now + state.remainingMs }
}

export function pause(state: PomodoroState, now: number): PomodoroState {
  if (state.status !== 'running') return state
  return { ...state, status: 'paused', endsAt: null, remainingMs: remainingMs(state, now) }
}

/** Returns the current session to its full length, stopped. The streak is kept. */
export function reset(state: PomodoroState, settings: PomodoroSettings): PomodoroState {
  return initialState(settings, state.mode, state.focusStreak)
}

function following(state: PomodoroState, settings: PomodoroSettings, countFocus: boolean): { mode: PomodoroMode; focusStreak: number } {
  if (state.mode !== 'focus') return { mode: 'focus', focusStreak: state.mode === 'long' ? 0 : state.focusStreak }
  const streak = state.focusStreak + (countFocus ? 1 : 0)
  const long = countFocus && streak > 0 && streak % Math.max(1, settings.longEvery) === 0
  return { mode: long ? 'long' : 'short', focusStreak: streak }
}

/**
 * Moves to the next session without finishing the current one. A skipped focus session does
 * not count towards the long-break streak.
 */
export function skip(state: PomodoroState, settings: PomodoroSettings, now: number): { state: PomodoroState; finished: FinishedSession | null } {
  const planned = durationMs(state.mode, settings)
  const finished: FinishedSession | null =
    state.startedAt !== null ? { mode: state.mode, startedAt: state.startedAt, endedAt: now, plannedMs: planned, completed: false } : null
  const next = following(state, settings, false)
  return { state: initialState(settings, next.mode, next.focusStreak), finished }
}

/**
 * Checks whether the running session has reached its end. Called on every display tick, when
 * the app starts, and when the computer wakes. If the end passed while nothing was watching
 * (app closed, computer asleep), the session is recorded as completed at its planned end time.
 * The next session auto-starts only when the end was reached just now, so the app never
 * silently runs through sessions nobody was present for.
 */
export function advance(state: PomodoroState, settings: PomodoroSettings, now: number): { state: PomodoroState; finished: FinishedSession | null } {
  if (state.status !== 'running' || state.endsAt === null || now < state.endsAt) return { state, finished: null }
  const finished: FinishedSession = {
    mode: state.mode,
    startedAt: state.startedAt ?? state.endsAt - durationMs(state.mode, settings),
    endedAt: state.endsAt,
    plannedMs: durationMs(state.mode, settings),
    completed: true
  }
  const next = following(state, settings, true)
  const idle = initialState(settings, next.mode, next.focusStreak)
  const justEnded = now - state.endsAt <= AUTO_START_GRACE_MS
  return { state: settings.autoStart && justEnded ? start(idle, now) : idle, finished }
}

/** Applies new durations. A stopped session takes the new length; a running or paused one is left alone. */
export function applySettings(state: PomodoroState, settings: PomodoroSettings): PomodoroState {
  return state.status === 'idle' ? initialState(settings, state.mode, state.focusStreak) : state
}

const isMode = (value: unknown): value is PomodoroMode => value === 'focus' || value === 'short' || value === 'long'

/** Validates state read back from storage; anything inconsistent falls back to a fresh idle timer. */
export function reviveState(raw: unknown, settings: PomodoroSettings): PomodoroState {
  const fresh = initialState(settings)
  if (!raw || typeof raw !== 'object') return fresh
  const value = raw as Partial<PomodoroState>
  if (!isMode(value.mode)) return fresh
  const streak = Number.isInteger(value.focusStreak) && value.focusStreak! >= 0 ? value.focusStreak! : 0
  const maximum = 24 * 3600_000
  const startedAt = typeof value.startedAt === 'number' && Number.isFinite(value.startedAt) ? value.startedAt : null
  if (value.status === 'running' && typeof value.endsAt === 'number' && Number.isFinite(value.endsAt) && startedAt !== null && value.endsAt - startedAt <= maximum) {
    return { mode: value.mode, status: 'running', startedAt, endsAt: value.endsAt, remainingMs: 0, focusStreak: streak }
  }
  if (value.status === 'paused' && typeof value.remainingMs === 'number' && value.remainingMs > 0 && value.remainingMs <= maximum) {
    return { mode: value.mode, status: 'paused', startedAt, endsAt: null, remainingMs: value.remainingMs, focusStreak: streak }
  }
  return initialState(settings, value.mode, streak)
}

export function sanitizeSettings(raw: unknown): PomodoroSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<PomodoroSettings>
  const minutes = (input: unknown, fallback: number, max: number): number =>
    typeof input === 'number' && Number.isFinite(input) ? Math.min(max, Math.max(1, Math.round(input))) : fallback
  return {
    focusMinutes: minutes(value.focusMinutes, DEFAULT_POMODORO_SETTINGS.focusMinutes, 180),
    shortMinutes: minutes(value.shortMinutes, DEFAULT_POMODORO_SETTINGS.shortMinutes, 60),
    longMinutes: minutes(value.longMinutes, DEFAULT_POMODORO_SETTINGS.longMinutes, 120),
    longEvery: minutes(value.longEvery, DEFAULT_POMODORO_SETTINGS.longEvery, 12),
    autoStart: typeof value.autoStart === 'boolean' ? value.autoStart : DEFAULT_POMODORO_SETTINGS.autoStart,
    sound: typeof value.sound === 'boolean' ? value.sound : DEFAULT_POMODORO_SETTINGS.sound,
    notify: typeof value.notify === 'boolean' ? value.notify : DEFAULT_POMODORO_SETTINGS.notify
  }
}

/** "24:59" for display. Rounds up so a session shows its full length when it starts. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
