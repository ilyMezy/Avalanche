import { and, asc, eq, isNotNull, isNull, lte } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import { nextOccurrence, planFiring } from '@shared/domain/recurrence'
import { uuidv7 } from '@shared/domain/uuid'
import type { Recurrence, Reminder, Task } from '@shared/types'
import { reminders, tasks } from '../infrastructure/db/schema'
import type { AppContext } from './context'

type TaskRow = typeof tasks.$inferSelect
type ReminderRow = typeof reminders.$inferSelect

interface ReminderInput {
  localDate: string
  localTime: string
  recurrence: Recurrence
}

export interface TaskInput {
  id?: string
  title: string
  notes: string
  dueDate: string | null
  dueTime: string | null
  reminder: ReminderInput | null
}

export interface FiredReminder {
  reminder: Reminder
  result: 'delivered' | 'missed'
}

function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    taskId: row.taskId,
    title: row.title,
    localDate: row.localDate,
    localTime: row.localTime,
    recurrence: row.recurrence as Recurrence,
    enabled: row.enabled,
    nextDueAt: row.nextDueAt,
    lastFiredAt: row.lastFiredAt,
    missed: row.missed
  }
}

export class PlannerService {
  constructor(private readonly ctx: AppContext) {}

  private taskRow(id: string): TaskRow {
    const row = this.ctx.db.select().from(tasks).where(eq(tasks.id, id)).get()
    if (!row) throw new AppError('NOT_FOUND', 'That task no longer exists.')
    return row
  }

  private toTask(row: TaskRow): Task {
    const reminder = this.ctx.db.select().from(reminders).where(eq(reminders.taskId, row.id)).get()
    return { ...row, reminder: reminder ? toReminder(reminder) : null }
  }

  listTasks(): Task[] {
    return this.ctx.db.select().from(tasks).orderBy(asc(tasks.createdAt)).all().map((row) => this.toTask(row))
  }

  private writeReminder(id: string | null, taskId: string | null, title: string, input: ReminderInput): string {
    const now = this.ctx.now()
    const nextDueAt = nextOccurrence(input.localDate, input.localTime, input.recurrence, now)
    const values = {
      taskId,
      title,
      localDate: input.localDate,
      localTime: input.localTime,
      recurrence: input.recurrence,
      enabled: nextDueAt !== null,
      nextDueAt,
      missed: false,
      updatedAt: now
    }
    if (id) {
      this.ctx.db.update(reminders).set(values).where(eq(reminders.id, id)).run()
      return id
    }
    const newId = uuidv7()
    this.ctx.db.insert(reminders).values({ id: newId, ...values, createdAt: now }).run()
    return newId
  }

  saveTask(input: TaskInput): Task {
    const now = this.ctx.now()
    const id = input.id ?? uuidv7()
    const values = { title: input.title, notes: input.notes, dueDate: input.dueDate, dueTime: input.dueTime, updatedAt: now }
    if (input.id) {
      this.taskRow(input.id)
      this.ctx.db.update(tasks).set(values).where(eq(tasks.id, id)).run()
    } else {
      this.ctx.db.insert(tasks).values({ id, ...values, createdAt: now }).run()
    }
    const existing = this.ctx.db.select().from(reminders).where(eq(reminders.taskId, id)).get()
    if (input.reminder) this.writeReminder(existing?.id ?? null, id, input.title, input.reminder)
    else if (existing) this.ctx.db.delete(reminders).where(eq(reminders.id, existing.id)).run()
    return this.toTask(this.taskRow(id))
  }

  setCompleted(id: string, completed: boolean): Task {
    this.taskRow(id)
    const now = this.ctx.now()
    this.ctx.db.update(tasks).set({ completedAt: completed ? now : null, updatedAt: now }).where(eq(tasks.id, id)).run()
    const reminder = this.ctx.db.select().from(reminders).where(eq(reminders.taskId, id)).get()
    if (reminder) {
      // A completed task stops reminding; reopening it re-arms any occurrence still in the future.
      const nextDueAt = completed ? null : nextOccurrence(reminder.localDate, reminder.localTime, reminder.recurrence as Recurrence, now)
      this.ctx.db
        .update(reminders)
        .set({ enabled: nextDueAt !== null, nextDueAt, missed: false, updatedAt: now })
        .where(eq(reminders.id, reminder.id))
        .run()
    }
    return this.toTask(this.taskRow(id))
  }

  deleteTask(id: string): void {
    this.ctx.db.delete(tasks).where(eq(tasks.id, id)).run()
  }

  listReminders(): Reminder[] {
    return this.ctx.db.select().from(reminders).orderBy(asc(reminders.nextDueAt)).all().map(toReminder)
  }

  saveReminder(input: ReminderInput & { id?: string; title: string }): Reminder {
    if (input.id) {
      const existing = this.ctx.db.select().from(reminders).where(eq(reminders.id, input.id)).get()
      if (!existing) throw new AppError('NOT_FOUND', 'That reminder no longer exists.')
      this.writeReminder(existing.id, existing.taskId, input.title, input)
      return toReminder(this.ctx.db.select().from(reminders).where(eq(reminders.id, existing.id)).get()!)
    }
    const id = this.writeReminder(null, null, input.title, input)
    return toReminder(this.ctx.db.select().from(reminders).where(eq(reminders.id, id)).get()!)
  }

  deleteReminder(id: string): void {
    this.ctx.db.delete(reminders).where(eq(reminders.id, id)).run()
  }

  acknowledgeReminder(id: string): void {
    this.ctx.db.update(reminders).set({ missed: false }).where(eq(reminders.id, id)).run()
  }

  /**
   * Finds reminders whose time has come, advances or disables each one, and returns them for
   * delivery. An occurrence that came due long before this call (for example while the app was
   * closed) is reported as missed instead of delivered. Each reminder fires at most once per
   * occurrence because its `next_due_at` moves forward in the same transaction.
   */
  processDue(nowMs: number = this.ctx.now()): FiredReminder[] {
    const dueRows = this.ctx.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.enabled, true), isNotNull(reminders.nextDueAt), lte(reminders.nextDueAt, nowMs)))
      .all()
    const fired: FiredReminder[] = []
    for (const row of dueRows) {
      const plan = planFiring(
        { localDate: row.localDate, localTime: row.localTime, recurrence: row.recurrence as Recurrence, nextDueAt: row.nextDueAt! },
        nowMs
      )
      this.ctx.db
        .update(reminders)
        .set({ nextDueAt: plan.nextDueAt, enabled: plan.enabled, lastFiredAt: nowMs, missed: plan.result === 'missed', updatedAt: nowMs })
        .where(eq(reminders.id, row.id))
        .run()
      fired.push({ reminder: toReminder(this.ctx.db.select().from(reminders).where(eq(reminders.id, row.id)).get()!), result: plan.result })
    }
    return fired
  }

  /** Tasks that are not completed, for callers that only need open work. */
  openTasks(): Task[] {
    return this.ctx.db.select().from(tasks).where(isNull(tasks.completedAt)).all().map((row) => this.toTask(row))
  }
}
