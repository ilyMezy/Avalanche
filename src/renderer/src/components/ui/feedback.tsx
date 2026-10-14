import { AlertTriangle, Check, CircleAlert, Loader2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { create } from 'zustand'
import type { SaveState } from '@/app/store'
import { Ridges } from '@/components/Logo'
import { IS_MAC } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { Button } from './button'

export const EASE_OUT = [0.16, 1, 0.3, 1] as const

export function Spinner({ size = 14, className }: { size?: number; className?: string }): ReactNode {
  return <Loader2 size={size} className={cn('animate-spin text-subtle', className)} aria-label="Loading" />
}

export function Kbd({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line-strong bg-surface px-1 font-sans text-[10.5px] text-muted">
      {children === 'Ctrl' && IS_MAC ? '⌘' : children}
    </kbd>
  )
}

/** An intentional empty state: what belongs here, and the primary action to get started. */
export function EmptyState({
  icon,
  title,
  body,
  children,
  compact
}: {
  icon: ReactNode
  title: string
  body?: string
  children?: ReactNode
  compact?: boolean
}): ReactNode {
  return (
    <div className={cn('animate-rise flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'h-full px-6 py-16')}>
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-hover text-subtle">{icon}</div>
      <div className="text-[13px] font-medium text-fg">{title}</div>
      {body && <p className="mt-1 max-w-[360px] text-xs leading-relaxed text-muted">{body}</p>}
      {children && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{children}</div>}
      {/* A quiet ridgeline under full-page empty states; it fades out at both ends. */}
      {!compact && <Ridges className="ridge-fade pointer-events-none mt-8 h-10 w-[320px] max-w-full" />}
    </div>
  )
}

/** Page heading used by every section, so titles sit at the same height and size everywhere. */
export function SectionHeader({ title, description, children }: { title: ReactNode; description?: string; children?: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-9 items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-[20px] leading-7 font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

/** A small uppercase label that introduces a group of rows. */
export function GroupLabel({ children, action }: { children: ReactNode; action?: ReactNode }): ReactNode {
  return (
    <div className="flex h-7 items-center justify-between">
      <h2 className="font-sans text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">{children}</h2>
      {action}
    </div>
  )
}

const SAVE_VIEWS = {
  saved: { text: 'Saved', className: 'text-subtle', icon: <Check size={13} /> },
  dirty: { text: 'Unsaved changes', className: 'text-muted', icon: <span className="h-1.5 w-1.5 rounded-full bg-warning" /> },
  saving: { text: 'Saving…', className: 'text-muted', icon: <Spinner size={12} /> },
  error: { text: 'Save failed', className: 'text-danger', icon: <CircleAlert size={13} /> },
  conflict: { text: 'Changed on disk', className: 'text-warning', icon: <AlertTriangle size={13} /> }
} as const

/**
 * Save status, always visible in the document header (spec DOC-03, UI-11). The badge is
 * right-aligned in a fixed-width slot and crossfades, so status changes never shift the layout.
 */
export function SaveBadge({ state }: { state: SaveState | undefined }): ReactNode {
  const status = state?.status ?? 'saved'
  const view = SAVE_VIEWS[status]
  return (
    <span className="flex w-[128px] shrink-0 justify-end">
      <span
        key={status}
        role="status"
        title={state?.message}
        data-testid="save-status"
        className={cn('animate-fade inline-flex items-center gap-1.5 text-xs whitespace-nowrap', view.className)}
      >
        {view.icon}
        {view.text}
      </span>
    </span>
  )
}

/** Shown inside an editor when a save was refused because the file changed on disk, or failed. */
export function SaveProblemBanner({
  state,
  onReload,
  onOverwrite,
  onRetry
}: {
  state: SaveState | undefined
  onReload(): void
  onOverwrite(): void
  onRetry(): void
}): ReactNode {
  const visible = state?.status === 'conflict' || state?.status === 'error'
  const conflict = state?.status === 'conflict'
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          role="alert"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="shrink-0 overflow-hidden"
        >
          <div
            className={cn(
              'flex items-center gap-3 border-b px-4 py-2 text-xs text-fg',
              conflict ? 'border-warning/25 bg-warning/10' : 'border-danger/25 bg-danger-soft'
            )}
          >
            <AlertTriangle size={14} className={cn('shrink-0', conflict ? 'text-warning' : 'text-danger')} />
            <span className="flex-1">
              {conflict
                ? 'This file was changed on disk by another program. Autosave is paused so nothing is overwritten.'
                : `Save failed: ${state?.message ?? 'unknown error'}. Your changes are still here.`}
            </span>
            {conflict ? (
              <>
                <Button size="sm" onClick={onReload}>
                  Load the version on disk
                </Button>
                <Button size="sm" onClick={onOverwrite}>
                  Keep mine and overwrite
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

interface ToastItem {
  id: number
  message: string
  kind: 'info' | 'error'
}

const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }))
let nextToastId = 1

export function toast(message: string, kind: ToastItem['kind'] = 'info'): void {
  const id = nextToastId++
  useToasts.setState((state) => ({ items: [...state.items.slice(-3), { id, message, kind }] }))
  setTimeout(() => dismissToast(id), kind === 'error' ? 7000 : 4000)
}

function dismissToast(id: number): void {
  useToasts.setState((state) => ({ items: state.items.filter((item) => item.id !== id) }))
}

export function Toaster(): ReactNode {
  const items = useToasts((state) => state.items)
  return (
    <div className="pointer-events-none fixed right-4 bottom-9 z-[80] flex w-[340px] flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 16, transition: { duration: 0.14 } }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-[13px] text-fg shadow-pop"
          >
            {item.kind === 'error' && <CircleAlert size={15} className="mt-0.5 shrink-0 text-danger" />}
            <span className="selectable flex-1 leading-snug">{item.message}</span>
            <button aria-label="Dismiss" onClick={() => dismissToast(item.id)} className="rounded text-subtle hover:text-fg">
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
