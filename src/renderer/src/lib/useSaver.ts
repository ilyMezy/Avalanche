import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '@/app/store'
import { ApiError, errorMessage } from './api'

// Autosave engine shared by all three editors (spec DOC-02, DOC-03). An editor calls
// `markDirty()` on every change; the content is saved after a short idle period, when the
// window loses focus, when the tab closes, and before the application quits.

const flushers = new Map<string, () => Promise<void>>()

/** Saves every document with unsaved changes. Used before the window closes. */
export async function flushAll(): Promise<void> {
  await Promise.allSettled(Array.from(flushers.values(), (flush) => flush()))
}

export async function flushOne(key: string): Promise<void> {
  await flushers.get(key)?.()
}

export interface Saver {
  markDirty(): void
  /** Saves now if there are unsaved changes. */
  flush(): Promise<void>
  /** Saves over a file that changed on disk, after the user explicitly chose to. */
  overwrite(): Promise<void>
  /** Clears the unsaved/conflict state after the editor reloaded content from disk. */
  reset(): void
}

export function useSaver(key: string, save: (force: boolean) => Promise<void>): Saver {
  const delay = useAppStore((state) => state.settings?.autosaveDelayMs ?? 1500)
  const saveRef = useRef(save)
  saveRef.current = save
  const delayRef = useRef(delay)
  delayRef.current = delay
  const dirty = useRef(false)
  const blocked = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)

  const run = useCallback(
    async (force: boolean): Promise<void> => {
      if (inFlight.current) await inFlight.current
      if (!dirty.current && !force) return
      if (blocked.current && !force) return
      if (timer.current) clearTimeout(timer.current)
      const setSaveState = useAppStore.getState().setSaveState
      dirty.current = false
      setSaveState(key, { status: 'saving' })
      inFlight.current = saveRef.current(force).then(
        () => {
          blocked.current = false
          setSaveState(key, dirty.current ? { status: 'dirty' } : { status: 'saved' })
        },
        (error: unknown) => {
          dirty.current = true
          if (error instanceof ApiError && error.code === 'CONFLICT') {
            // Autosave stops until the user decides which version to keep (spec 8.4).
            blocked.current = true
            setSaveState(key, { status: 'conflict', message: error.message })
          } else {
            setSaveState(key, { status: 'error', message: errorMessage(error) })
          }
        }
      )
      await inFlight.current
      inFlight.current = null
    },
    [key]
  )

  const saver = useMemo<Saver>(
    () => ({
      markDirty() {
        dirty.current = true
        if (blocked.current) return
        useAppStore.getState().setSaveState(key, { status: 'dirty' })
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void run(false), delayRef.current)
      },
      flush: () => run(false),
      overwrite: () => run(true),
      reset() {
        dirty.current = false
        blocked.current = false
        if (timer.current) clearTimeout(timer.current)
        useAppStore.getState().setSaveState(key, { status: 'saved' })
      }
    }),
    [key, run]
  )

  useEffect(() => {
    flushers.set(key, saver.flush)
    const onBlur = (): void => void saver.flush()
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      void saver.flush()
      flushers.delete(key)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [key, saver])

  return saver
}
