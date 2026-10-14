import type { CardState, Rating } from '../types'

// SM-2 spaced repetition exactly as specified in section 9.3 of the product specification.
// The scheduler is a pure function of (card state, rating, study date): it never reads the
// clock or the database, so it can be tested against the worked examples in Appendix B.

export interface ScheduleState {
  state: CardState
  repetitions: number
  intervalDays: number
  easeFactor: number
  lapses: number
  dueDate: string | null
  lastReviewDate: string | null
}

export const INITIAL_EASE = 2.5
export const MIN_EASE = 1.3
export const QUALITY: Record<Rating, number> = { again: 1, hard: 3, good: 4, easy: 5 }

export function initialSchedule(): ScheduleState {
  return {
    state: 'new',
    repetitions: 0,
    intervalDays: 0,
    easeFactor: INITIAL_EASE,
    lapses: 0,
    dueDate: null,
    lastReviewDate: null
  }
}

/** Adds whole days to a `YYYY-MM-DD` calendar date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const result = new Date(Date.UTC(y, m - 1, d + days))
  return result.toISOString().slice(0, 10)
}

/**
 * The local "study day" for an instant. The day rolls over at `rolloverHour` (default 04:00)
 * so that studying after midnight still counts as the previous day.
 */
export function studyDate(now: Date, rolloverHour = 4): string {
  const shifted = new Date(now.getTime() - rolloverHour * 3600_000)
  const y = shifted.getFullYear()
  const m = String(shifted.getMonth() + 1).padStart(2, '0')
  const d = String(shifted.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * A card that was already rated "Again" today is being repeated within the same session.
 * Same-day repeats do not change the schedule (spec 9.3, "Incorrect answers").
 */
export function isSameDayRepeat(card: ScheduleState, today: string): boolean {
  return card.lastReviewDate === today && card.state === 'learning' && card.repetitions === 0
}

export function schedule(card: ScheduleState, rating: Rating, today: string): ScheduleState {
  if (isSameDayRepeat(card, today)) return { ...card }

  const q = QUALITY[rating]
  let { repetitions, intervalDays, lapses } = card
  let state: CardState

  if (q < 3) {
    repetitions = 0
    intervalDays = 1
    lapses += 1
    state = 'learning'
  } else {
    // The interval uses the ease factor from before this review's adjustment.
    if (repetitions === 0) intervalDays = 1
    else if (repetitions === 1) intervalDays = 6
    else intervalDays = Math.round(intervalDays * card.easeFactor)
    repetitions += 1
    state = 'review'
  }

  const adjusted = card.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  const easeFactor = Math.max(MIN_EASE, Math.round(adjusted * 10000) / 10000)

  return {
    state,
    repetitions,
    intervalDays,
    easeFactor,
    lapses,
    dueDate: addDays(today, intervalDays),
    lastReviewDate: today
  }
}
