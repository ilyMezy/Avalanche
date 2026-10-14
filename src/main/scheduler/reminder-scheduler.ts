import type { FiredReminder, PlannerService } from '../services/planner'

// IN-APP REMINDER DELIVERY ONLY.
//
// This scheduler polls while the application is running. It does NOT deliver reminders when
// the app is closed: a JavaScript timer inside a running process cannot do that. Closed-app
// delivery requires registering a Windows Task Scheduler task that starts the packaged
// executable in a headless `--reminder-run` mode (spec section 10), which is not built yet.
//
// The pieces a future runner needs are already separated from this file:
//   - `PlannerService.processDue(now)` claims due occurrences and advances recurrences;
//   - `shared/domain/recurrence.ts` holds the pure timing rules.
// A runner would open the database, call `processDue`, show the notifications, and exit.

const POLL_INTERVAL_MS = 20_000

export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly planner: PlannerService,
    private readonly deliver: (fired: FiredReminder) => void
  ) {}

  start(): void {
    if (this.timer) return
    this.tick()
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  tick(): void {
    try {
      for (const fired of this.planner.processDue()) this.deliver(fired)
    } catch (error) {
      console.error('Reminder check failed', error)
    }
  }
}
