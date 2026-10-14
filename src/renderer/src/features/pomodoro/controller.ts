import { create } from 'zustand'
import {
  advance,
  DEFAULT_POMODORO_SETTINGS,
  initialState,
  pause,
  remainingMs,
  reset,
  skip,
  start,
  type FinishedSession,
  type PomodoroSettings,
  type PomodoroState
} from '@shared/domain/pomodoro'
import { toast } from '@/components/ui/feedback'
import { call, errorMessage } from '@/lib/api'

// The running Pomodoro timer. It lives outside React so it keeps time whichever screen is
// showing, and it never counts down by itself: every reading is `endsAt - now`.
//
// Clock strategy. While the app runs, `now` comes from a monotonic clock (performance.now)
// anchored to the wall clock, so a manual change to the system time does not jolt a running
// session. The anchor is re-taken whenever the two clocks disagree by more than a second and a
// half, which is what happens when the computer sleeps (the monotonic clock pauses, the wall
// clock does not), and whenever the main process reports a wake. Persisted end times are
// wall-clock, which is what lets a session be recovered after the app restarts.

interface Store {
  ready: boolean
  settings: PomodoroSettings
  state: PomodoroState
  /** The current time, advanced once per displayed second, so components re-render at most 1×/s. */
  now: number
  completedToday: number
  history: FinishedSession[]
}

export const usePomodoro = create<Store>(() => ({
  ready: false,
  settings: DEFAULT_POMODORO_SETTINGS,
  state: initialState(DEFAULT_POMODORO_SETTINGS),
  now: Date.now(),
  completedToday: 0,
  history: []
}))

const DRIFT_TOLERANCE_MS = 1500
let wallAnchor = Date.now()
let monoAnchor = performance.now()
let timer: ReturnType<typeof setInterval> | null = null

function anchor(): void {
  wallAnchor = Date.now()
  monoAnchor = performance.now()
}

function clock(): number {
  const estimate = wallAnchor + (performance.now() - monoAnchor)
  if (Math.abs(Date.now() - estimate) > DRIFT_TOLERANCE_MS) {
    anchor()
    return wallAnchor
  }
  return estimate
}

function persist(state: PomodoroState): void {
  void call('pomodoro.saveState', { state: { ...state } }).catch(() => undefined)
}

/** A short two-note chime generated locally; no audio file is shipped or fetched. */
function chime(): void {
  try {
    const context = new AudioContext()
    const play = (frequency: number, at: number): void => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, context.currentTime + at)
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + at + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + at + 0.7)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(context.currentTime + at)
      oscillator.stop(context.currentTime + at + 0.75)
    }
    play(659.25, 0)
    play(880, 0.22)
    setTimeout(() => void context.close(), 1500)
  } catch {
    // Sound is optional; a machine without an audio device simply stays silent.
  }
}

async function record(session: FinishedSession, announce: boolean): Promise<void> {
  const { settings } = usePomodoro.getState()
  if (announce && session.completed && settings.sound) chime()
  try {
    const snapshot = await call('pomodoro.logSession', { ...session, notify: announce && settings.notify })
    usePomodoro.setState({ completedToday: snapshot.completedToday, history: snapshot.history })
  } catch (error) {
    toast(errorMessage(error), 'error')
  }
}

/** Re-reads the clock and completes the session if its end has passed. */
function tick(announce = true): void {
  const store = usePomodoro.getState()
  if (!store.ready) return
  const now = clock()
  const result = advance(store.state, store.settings, now)
  if (result.finished) {
    usePomodoro.setState({ state: result.state, now })
    persist(result.state)
    syncTimer()
    void record(result.finished, announce)
    return
  }
  // Publish a new time only when the displayed second changes.
  const shown = Math.ceil(remainingMs(store.state, store.now) / 1000)
  if (Math.ceil(remainingMs(store.state, now) / 1000) !== shown) usePomodoro.setState({ now })
}

/** The clock is read four times a second only while a session is running; otherwise not at all. */
function syncTimer(): void {
  const running = usePomodoro.getState().state.status === 'running'
  if (running && !timer) timer = setInterval(() => tick(), 250)
  else if (!running && timer) {
    clearInterval(timer)
    timer = null
  }
}

function apply(next: PomodoroState): void {
  usePomodoro.setState({ state: next, now: clock() })
  persist(next)
  syncTimer()
}

export const pomodoro = {
  /** Loads the saved timer. A session that ended while the app was closed is completed quietly. */
  async load(): Promise<void> {
    const snapshot = await call('pomodoro.get')
    anchor()
    usePomodoro.setState({ ...snapshot, now: wallAnchor, ready: true })
    tick(false)
    syncTimer()
  },
  /** Called when the computer wakes or the window becomes visible again. */
  resync(): void {
    anchor()
    tick(false)
  },
  toggle(): void {
    const { state } = usePomodoro.getState()
    const now = clock()
    apply(state.status === 'running' ? pause(state, now) : start(state, now))
  },
  reset(): void {
    const { state, settings } = usePomodoro.getState()
    apply(reset(state, settings))
  },
  skip(): void {
    const { state, settings } = usePomodoro.getState()
    const result = skip(state, settings, clock())
    apply(result.state)
    if (result.finished) void record(result.finished, false)
  },
  async saveSettings(patch: Partial<PomodoroSettings>): Promise<void> {
    try {
      const snapshot = await call('pomodoro.saveSettings', { settings: { ...usePomodoro.getState().settings, ...patch } })
      usePomodoro.setState({ settings: snapshot.settings, state: snapshot.state, now: clock() })
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }
}
