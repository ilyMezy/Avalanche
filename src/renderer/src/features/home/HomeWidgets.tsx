import { ArrowDown, ArrowLeftRight, ArrowUp, Check, ImagePlus, Plus, Target, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  addGoal,
  defaultHome,
  MAX_GOAL_TARGET,
  removeGoal,
  stepGoal,
  toggleGoal,
  updateWidget,
  WIDGET_LABELS,
  type Goal,
  type HomeConfig,
  type HomeWidget
} from '@shared/domain/home'
import { Button, IconButton } from '@/components/ui/button'
import { Input } from '@/components/ui/controls'
import { toast } from '@/components/ui/feedback'
import { call, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

const SAVE_DELAY_MS = 400

/**
 * The Home layout and goals. Changes show at once and are written a moment later, so typing in a
 * note does not save on every key; anything pending is written when the page is left.
 */
export function useHome(): { config: HomeConfig | null; change(update: (current: HomeConfig) => HomeConfig): void } {
  const [config, setConfig] = useState<HomeConfig | null>(null)
  const latest = useRef<HomeConfig | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (latest.current) void call('home.save', latest.current).catch((error) => toast(errorMessage(error), 'error'))
  }, [])

  useEffect(() => {
    call('home.get').then(
      (loaded) => {
        latest.current = loaded
        setConfig(loaded)
      },
      () => {
        latest.current = defaultHome()
        setConfig(latest.current)
      }
    )
    return () => {
      if (timer.current) flush()
    }
  }, [flush])

  const change = useCallback(
    (update: (current: HomeConfig) => HomeConfig) => {
      if (!latest.current) return
      const next = update(latest.current)
      if (next === latest.current) return
      latest.current = next
      setConfig(next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, SAVE_DELAY_MS)
    },
    [flush]
  )

  return { config, change }
}

/** A titled card: the surface every widget sits on. */
export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }): ReactNode {
  return (
    <section aria-label={title} className={cn('rounded-2xl border border-line bg-surface p-5', className)}>
      <div className="mb-2 flex h-7 items-center justify-between gap-3">
        <h2 className="truncate text-[15px] font-semibold tracking-tight text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** While customizing, each widget carries a strip of controls: reorder, change column, remove. */
export function WidgetControls({
  widget,
  first,
  last,
  onMove,
  onSwitch,
  onRemove
}: {
  widget: HomeWidget
  first: boolean
  last: boolean
  onMove(delta: -1 | 1): void
  onSwitch(): void
  onRemove(): void
}): ReactNode {
  const name = widget.type === 'text' && widget.title ? widget.title : WIDGET_LABELS[widget.type]
  return (
    <div className="mb-1.5 flex h-8 items-center gap-0.5 rounded-lg border border-dashed border-line-strong bg-raised pr-1 pl-3" role="group" aria-label={`Arrange ${name}`}>
      <span className="mr-auto truncate text-xs font-medium text-muted">{name}</span>
      <IconButton label={`Move ${name} up`} className="h-6 w-6" disabled={first} onClick={() => onMove(-1)}>
        <ArrowUp size={13} />
      </IconButton>
      <IconButton label={`Move ${name} down`} className="h-6 w-6" disabled={last} onClick={() => onMove(1)}>
        <ArrowDown size={13} />
      </IconButton>
      <IconButton label={`Move ${name} to the other column`} className="h-6 w-6" onClick={onSwitch}>
        <ArrowLeftRight size={13} />
      </IconButton>
      <IconButton label={`Remove ${name}`} className="h-6 w-6 hover:text-danger" onClick={onRemove}>
        <Trash2 size={13} />
      </IconButton>
    </div>
  )
}

function GoalRow({ goal, onToggle, onStep, onRemove }: { goal: Goal; onToggle(): void; onStep(): void; onRemove(): void }): ReactNode {
  const counted = goal.target > 0
  return (
    <div data-testid="goal-row" className="group -mx-2 rounded-lg px-2 py-1.5 hover:bg-hover">
      <div className="flex min-h-8 items-center gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={goal.done}
          aria-label={goal.done ? `Mark “${goal.title}” as not done` : `Mark “${goal.title}” as done`}
          onClick={onToggle}
          className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', goal.done ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong hover:border-accent')}
        >
          {goal.done && <Check size={13} strokeWidth={3} />}
        </button>
        <span className={cn('min-w-0 flex-1 text-[14px] leading-snug', goal.done ? 'text-subtle line-through' : 'text-fg')}>{goal.title}</span>
        {counted && (
          <>
            <span className="shrink-0 text-[13px] text-muted tabular-nums" data-testid="goal-progress">
              {goal.progress} / {goal.target}
            </span>
            <IconButton label={`Add one to “${goal.title}”`} className="h-7 w-7 border border-line" disabled={goal.done} onClick={onStep}>
              <Plus size={14} />
            </IconButton>
          </>
        )}
        <IconButton label={`Delete goal “${goal.title}”`} className="h-7 w-7 text-subtle hover:text-danger" onClick={onRemove}>
          <Trash2 size={14} />
        </IconButton>
      </div>
      {counted && (
        <div className="mt-1 ml-8 h-1.5 overflow-hidden rounded-full bg-line-strong" role="progressbar" aria-label={`Progress on ${goal.title}`} aria-valuemin={0} aria-valuemax={goal.target} aria-valuenow={goal.progress}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${(goal.progress / goal.target) * 100}%` }} />
        </div>
      )}
    </div>
  )
}

/** Goals: things to tick off, or to count up towards a number. */
export function GoalsWidget({ config, change }: { config: HomeConfig; change(update: (current: HomeConfig) => HomeConfig): void }): ReactNode {
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const done = config.goals.filter((goal) => goal.done).length
  const add = (): void => {
    if (!title.trim()) return
    change((current) => addGoal(current, title, Number(target) || 0))
    setTitle('')
    setTarget('')
  }
  return (
    <Section
      title="Goals"
      action={
        config.goals.length > 0 ? (
          <span className="text-[13px] text-muted" data-testid="goals-summary">
            {done} of {config.goals.length} done
          </span>
        ) : undefined
      }
    >
      {config.goals.length === 0 && (
        <div className="flex items-center gap-3.5 py-2 text-[13px] text-muted">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-hover text-subtle">
            <Target size={17} />
          </span>
          <span className="leading-relaxed">Write down what you are working towards. Give a goal a number of steps to track progress, for example “Read 12 chapters”.</span>
        </div>
      )}
      {config.goals.map((goal) => (
        <GoalRow
          key={goal.id}
          goal={goal}
          onToggle={() => change((current) => toggleGoal(current, goal.id))}
          onStep={() => change((current) => stepGoal(current, goal.id, 1))}
          onRemove={() => change((current) => removeGoal(current, goal.id))}
        />
      ))}
      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <Input aria-label="New goal" placeholder="Add a goal…" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} className="h-9 min-w-0 flex-1 text-[13px]" />
        <Input
          aria-label="Steps (optional)"
          title="Number of steps, if the goal is counted"
          placeholder="Steps"
          type="number"
          min={0}
          max={MAX_GOAL_TARGET}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          className="h-9 w-[76px] text-[13px] tabular-nums"
        />
        <Button type="submit" variant="primary" className="h-9" disabled={!title.trim()}>
          Add
        </Button>
      </form>
    </Section>
  )
}

/** One of the user's own pictures, with an optional caption. */
export function PictureWidget({ widget, editing, change }: { widget: HomeWidget; editing: boolean; change(update: (current: HomeConfig) => HomeConfig): void }): ReactNode {
  const [source, setSource] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSource(null)
    setMissing(false)
    if (!widget.imageId) return
    call('home.image', { id: widget.imageId }).then(
      (data) => {
        if (cancelled) return
        setSource(data)
        setMissing(data === null)
      },
      () => !cancelled && setMissing(true)
    )
    return () => {
      cancelled = true
    }
  }, [widget.imageId])

  const choose = async (): Promise<void> => {
    try {
      const picked = await call('home.pickImage')
      if (picked) change((current) => updateWidget(current, widget.id, { imageId: picked.imageId }))
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  return (
    <section aria-label={widget.title || 'Picture'} data-testid="picture-widget" className="overflow-hidden rounded-2xl border border-line bg-surface">
      {source ? (
        <img src={source} alt={widget.title} className="block max-h-[340px] w-full object-cover" draggable={false} />
      ) : (
        <button type="button" onClick={() => void choose()} className="flex h-[168px] w-full flex-col items-center justify-center gap-2 text-muted hover:bg-hover hover:text-fg">
          <ImagePlus size={24} />
          <span className="text-[13px]">{missing ? 'This picture is missing. Choose another…' : 'Choose a picture…'}</span>
        </button>
      )}
      {editing ? (
        <div className="flex items-center gap-2 border-t border-line p-3">
          <Input
            aria-label="Picture caption"
            placeholder="Caption (optional)"
            value={widget.title}
            maxLength={120}
            onChange={(event) => change((current) => updateWidget(current, widget.id, { title: event.target.value }))}
            className="h-8 min-w-0 flex-1 text-[13px]"
          />
          <Button size="sm" onClick={() => void choose()}>
            {source ? 'Replace' : 'Choose'}
          </Button>
        </div>
      ) : (
        widget.title && <div className="border-t border-line px-4 py-2.5 text-[13px] text-muted">{widget.title}</div>
      )}
    </section>
  )
}

/** A free-text note that lives on the Home page and saves as you type. */
export function NoteWidget({ widget, editing, change }: { widget: HomeWidget; editing: boolean; change(update: (current: HomeConfig) => HomeConfig): void }): ReactNode {
  return (
    <section aria-label={widget.title || 'Note'} data-testid="note-widget" className="rounded-2xl border border-line bg-surface p-5">
      {editing ? (
        <Input
          aria-label="Note heading"
          placeholder="Heading"
          value={widget.title}
          maxLength={120}
          onChange={(event) => change((current) => updateWidget(current, widget.id, { title: event.target.value }))}
          className="mb-2 h-8 text-[14px] font-semibold"
        />
      ) : (
        widget.title && <h2 className="mb-2 truncate text-[15px] font-semibold tracking-tight text-fg">{widget.title}</h2>
      )}
      <textarea
        aria-label={`${widget.title || 'Note'} text`}
        placeholder="Write anything here: a quote, a timetable, a reminder to yourself…"
        value={widget.text}
        maxLength={4000}
        rows={Math.min(12, Math.max(3, widget.text.split('\n').length + 1))}
        onChange={(event) => change((current) => updateWidget(current, widget.id, { text: event.target.value }))}
        className="selectable block w-full resize-none bg-transparent text-[14px] leading-relaxed text-fg outline-none placeholder:text-subtle"
      />
    </section>
  )
}

/** A stored Home picture as something an <img> or a CSS background can show; null while loading or missing. */
export function useHomeImage(id: string | null): string | null {
  const [source, setSource] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setSource(null)
    if (!id) return
    call('home.image', { id }).then(
      (data) => !cancelled && setSource(data),
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [id])
  return source
}

/** Settings control: a picture of your own behind the greeting on Home, or the default ridgeline. */
export function GreetingBackgroundSetting(): ReactNode {
  const { config, change } = useHome()
  const preview = useHomeImage(config?.heroImage ?? null)
  if (!config) return null
  const choose = async (): Promise<void> => {
    try {
      const picked = await call('home.pickImage')
      if (picked) change((current) => ({ ...current, heroImage: picked.imageId }))
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="hero-wash h-12 w-24 shrink-0 overflow-hidden rounded-lg border border-line bg-cover bg-center"
        style={preview ? { backgroundImage: `url("${preview}")` } : undefined}
        data-testid="greeting-background-preview"
        aria-hidden
      />
      <Button onClick={() => void choose()}>
        <ImagePlus size={14} />
        {config.heroImage ? 'Change picture' : 'Choose picture'}
      </Button>
      {config.heroImage && <Button onClick={() => change((current) => ({ ...current, heroImage: null }))}>Use the default</Button>}
    </div>
  )
}
