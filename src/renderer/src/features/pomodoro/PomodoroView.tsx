import { Pause, Play, RotateCcw, Settings2, SkipForward, Timer, Volume2, VolumeX } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { durationMs, formatClock, MODE_LABELS, remainingMs, type PomodoroMode, type PomodoroSettings } from '@shared/domain/pomodoro'
import { useAppStore } from '@/app/store'
import { Button, IconButton } from '@/components/ui/button'
import { Input } from '@/components/ui/controls'
import { GroupLabel, Spinner } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlays'
import { cn, formatTimestamp } from '@/lib/utils'
import { pomodoro, usePomodoro } from './controller'

const MODE_TONE: Record<PomodoroMode, string> = { focus: 'var(--accent-text)', short: 'var(--success)', long: 'var(--warning)' }

/** The progress ring. The arc is the share of the session that is left. */
function Ring({ fraction, color, children }: { fraction: number; color: string; children: ReactNode }): ReactNode {
  const radius = 132
  const circumference = 2 * Math.PI * radius
  return (
    <div className="relative h-[300px] w-[300px]">
      <svg viewBox="0 0 300 300" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="150" cy="150" r={radius} fill="none" stroke="var(--line-strong)" strokeWidth="6" />
        <circle
          cx="150"
          cy="150"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, fraction)))}
          style={{ transition: 'stroke-dashoffset 0.5s linear, stroke 0.3s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

function MinutesField({ label, value, max, onCommit }: { label: string; value: number; max: number; onCommit(value: number): void }): ReactNode {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[13px] text-fg">{label}</span>
      <Input
        type="number"
        min={1}
        max={max}
        defaultValue={value}
        key={value}
        aria-label={label}
        className="w-[76px] text-right tabular-nums"
        onBlur={(event) => {
          const next = Math.round(Number(event.target.value))
          if (Number.isFinite(next) && next >= 1 && next <= max && next !== value) onCommit(next)
          else event.target.value = String(value)
        }}
        onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
      />
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }): ReactNode {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-[13px] text-fg">
      {label}
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
    </label>
  )
}

/** Session lengths and behaviour, in a dialog so the timer screen itself stays uncluttered. */
function TimerSettings({ settings, onClose }: { settings: PomodoroSettings; onClose(): void }): ReactNode {
  const save = (patch: Partial<PomodoroSettings>): void => void pomodoro.saveSettings(patch)
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Timer settings"
      description="New lengths apply from the next session; a session already under way keeps its length."
      className="w-[420px]"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <section aria-label="Timer settings">
        <GroupLabel>Session lengths (minutes)</GroupLabel>
        <MinutesField label="Focus" value={settings.focusMinutes} max={180} onCommit={(focusMinutes) => save({ focusMinutes })} />
        <MinutesField label="Short break" value={settings.shortMinutes} max={60} onCommit={(shortMinutes) => save({ shortMinutes })} />
        <MinutesField label="Long break" value={settings.longMinutes} max={120} onCommit={(longMinutes) => save({ longMinutes })} />
        <MinutesField label="Long break after (sessions)" value={settings.longEvery} max={12} onCommit={(longEvery) => save({ longEvery })} />
        <div className="mt-2 border-t border-line pt-2">
          <Toggle label="Start the next session automatically" checked={settings.autoStart} onChange={(autoStart) => save({ autoStart })} />
          <Toggle label="Play a sound when a session ends" checked={settings.sound} onChange={(sound) => save({ sound })} />
          <Toggle label="Show a Windows notification" checked={settings.notify} onChange={(notify) => save({ notify })} />
        </div>
      </section>
    </Modal>
  )
}

/**
 * The Focus screen: one centred timer with its controls, and under it today's progress and the
 * most recent sessions. Settings live behind the gear button.
 */
export function PomodoroView(): ReactNode {
  const { ready, settings, state, now, completedToday, history } = usePomodoro()
  const [showSettings, setShowSettings] = useState(false)
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }
  const left = remainingMs(state, now)
  const total = durationMs(state.mode, settings)
  const running = state.status === 'running'
  const streak = state.focusStreak % settings.longEvery
  const recent = history.slice(0, 5)

  return (
    <div className="h-full overflow-y-auto">
      {showSettings && <TimerSettings settings={settings} onClose={() => setShowSettings(false)} />}
      <div className="mx-auto flex max-w-[560px] flex-col items-center px-8 pt-8 pb-14">
        <div className="flex w-full items-center justify-between">
          <h1 className="text-[18px] font-semibold tracking-tight text-fg">Focus</h1>
          <IconButton label="Timer settings" onClick={() => setShowSettings(true)}>
            <Settings2 size={16} />
          </IconButton>
        </div>

        <div className="mt-8 flex gap-1 rounded-full border border-line bg-surface p-1" aria-label="Current mode">
          {(['focus', 'short', 'long'] as const).map((mode) => (
            <span
              key={mode}
              aria-current={state.mode === mode}
              className={cn('rounded-full px-3.5 py-1 text-xs transition-colors duration-150', state.mode === mode ? 'bg-active font-medium text-fg' : 'text-subtle')}
            >
              {MODE_LABELS[mode]}
            </span>
          ))}
        </div>

        <div className="mt-7">
          <Ring fraction={left / total} color={MODE_TONE[state.mode]}>
            <div className="text-[68px] leading-none font-semibold tracking-tight tabular-nums" data-testid="pomodoro-clock" role="timer" aria-live="off">
              {formatClock(left)}
            </div>
            <div className="mt-3 text-xs text-muted" data-testid="pomodoro-status">
              {MODE_LABELS[state.mode]} · {running ? 'running' : state.status === 'paused' ? 'paused' : 'ready'}
            </div>
          </Ring>
        </div>

        <div className="mt-7 flex items-center gap-3">
          <IconButton label="Reset this session" className="h-10 w-10 rounded-full border border-line" onClick={pomodoro.reset}>
            <RotateCcw size={16} />
          </IconButton>
          <Button variant="primary" className="h-11 w-[148px] rounded-full text-sm" onClick={pomodoro.toggle}>
            {running ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
            {running ? 'Pause' : state.status === 'paused' ? 'Resume' : 'Start'}
          </Button>
          <IconButton label="Skip to the next session" className="h-10 w-10 rounded-full border border-line" onClick={pomodoro.skip}>
            <SkipForward size={16} />
          </IconButton>
        </div>

        <div className="mt-9 grid w-full grid-cols-2 gap-3">
          <div className="rounded-xl border border-line bg-surface px-4 py-3">
            <div className="text-[11px] font-medium tracking-wide text-subtle uppercase">Today</div>
            <div className="mt-1 text-[13px] text-fg" data-testid="pomodoro-today">
              {completedToday} focus {completedToday === 1 ? 'session' : 'sessions'} completed today
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface px-4 py-3">
            <div className="text-[11px] font-medium tracking-wide text-subtle uppercase">Until a long break</div>
            <div className="mt-2.5 flex gap-1.5" aria-label={`${streak} of ${settings.longEvery} focus sessions before a long break`}>
              {Array.from({ length: settings.longEvery }, (_, index) => (
                <span key={index} className={cn('h-1.5 flex-1 rounded-full', index < streak ? 'bg-accent' : 'bg-line-strong')} />
              ))}
            </div>
          </div>
        </div>

        <section aria-label="Recent sessions" className="mt-3 w-full rounded-xl border border-line bg-surface px-4 py-3">
          <div className="text-[11px] font-medium tracking-wide text-subtle uppercase">Recent sessions</div>
          {recent.length === 0 ? (
            <p className="pt-1.5 text-xs text-subtle">Finished sessions appear here.</p>
          ) : (
            <div className="pt-1">
              {recent.map((session, index) => (
                <div key={index} className="flex h-7 items-center gap-2.5 text-xs">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: MODE_TONE[session.mode] }} />
                  <span className="flex-1 text-fg">{MODE_LABELS[session.mode]}</span>
                  <span className="text-subtle">{session.completed ? `${Math.round(session.plannedMs / 60000)} min` : 'skipped'}</span>
                  <span className="w-[92px] text-right text-subtle tabular-nums">{formatTimestamp(session.endedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * The compact timer for the top bar, shown while a session is running or paused so the time
 * stays visible while writing. Clicking the time opens the full Focus screen.
 */
export function PomodoroPill(): ReactNode {
  const { ready, settings, state, now } = usePomodoro()
  if (!ready || state.status === 'idle') return null
  const running = state.status === 'running'
  return (
    <div className="no-drag animate-fade flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-line bg-surface pr-0.5 pl-2" data-testid="pomodoro-pill">
      <button
        type="button"
        onClick={() => useAppStore.getState().setSection('focus')}
        className="flex items-center gap-1.5 text-xs text-fg"
        title={`${MODE_LABELS[state.mode]} · open Focus`}
      >
        <Timer size={12} style={{ color: MODE_TONE[state.mode] }} />
        <span className="tabular-nums">{formatClock(remainingMs(state, now))}</span>
      </button>
      <IconButton label={running ? 'Pause timer' : 'Resume timer'} className="h-6 w-6" onClick={pomodoro.toggle}>
        {running ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
      </IconButton>
      <IconButton label={settings.sound ? 'Mute timer sound' : 'Unmute timer sound'} className="h-6 w-6" onClick={() => void pomodoro.saveSettings({ sound: !settings.sound })}>
        {settings.sound ? <Volume2 size={11} /> : <VolumeX size={11} />}
      </IconButton>
    </div>
  )
}
