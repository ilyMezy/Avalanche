import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { reviveState, sanitizeSettings, applySettings, type FinishedSession, type PomodoroMode, type PomodoroSettings, type PomodoroState } from '@shared/domain/pomodoro'
import { uuidv7 } from '@shared/domain/uuid'
import type { PomodoroSnapshot } from '@shared/types'
import { pomodoroSessions } from '../infrastructure/db/schema'
import type { AppContext } from './context'
import type { SettingsService } from './settings'

const SETTINGS_KEY = 'pomodoro.settings'
const STATE_KEY = 'pomodoro.state'

/**
 * Persistence for the Pomodoro timer. The timer's rules are pure functions in
 * `shared/domain/pomodoro.ts`; this service only stores the settings, the current state
 * (including the wall-clock end time of a running session, which is what makes recovery after
 * a restart possible), and the history of finished sessions.
 */
export class PomodoroService {
  constructor(
    private readonly ctx: AppContext,
    private readonly store: SettingsService
  ) {}

  settings(): PomodoroSettings {
    return sanitizeSettings(this.store.getRaw(SETTINGS_KEY))
  }

  /** The stored state, validated. Anything inconsistent comes back as a fresh, stopped timer. */
  state(): PomodoroState {
    return reviveState(this.store.getRaw(STATE_KEY), this.settings())
  }

  saveState(raw: unknown): void {
    this.store.setRaw(STATE_KEY, reviveState(raw, this.settings()))
  }

  saveSettings(raw: unknown): PomodoroSnapshot {
    const settings = sanitizeSettings(raw)
    this.store.setRaw(SETTINGS_KEY, settings)
    this.store.setRaw(STATE_KEY, applySettings(this.state(), settings))
    return this.snapshot()
  }

  logSession(session: FinishedSession): void {
    this.ctx.db
      .insert(pomodoroSessions)
      .values({ id: uuidv7(), mode: session.mode, startedAt: session.startedAt, endedAt: session.endedAt, plannedMs: session.plannedMs, completed: session.completed })
      .run()
  }

  snapshot(): PomodoroSnapshot {
    const midnight = new Date(this.ctx.now())
    midnight.setHours(0, 0, 0, 0)
    const today = this.ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(pomodoroSessions)
      .where(and(eq(pomodoroSessions.mode, 'focus'), eq(pomodoroSessions.completed, true), gte(pomodoroSessions.endedAt, midnight.getTime())))
      .get()
    const history = this.ctx.db
      .select()
      .from(pomodoroSessions)
      .orderBy(desc(pomodoroSessions.endedAt))
      .limit(12)
      .all()
      .map((row): FinishedSession => ({ mode: row.mode as PomodoroMode, startedAt: row.startedAt, endedAt: row.endedAt, plannedMs: row.plannedMs, completed: row.completed }))
    return { settings: this.settings(), state: this.state(), completedToday: today?.count ?? 0, history }
  }
}
