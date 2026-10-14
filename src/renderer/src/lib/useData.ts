import { useCallback, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'

export type DataKey = 'workspace' | 'flashcards' | 'planner' | 'settings'

const useVersions = create<{ versions: Record<DataKey, number> }>(() => ({
  versions: { workspace: 0, flashcards: 0, planner: 0, settings: 0 }
}))

/** Marks cached data as stale; every `useData` subscribed to one of the keys reloads. */
export function invalidate(...keys: DataKey[]): void {
  useVersions.setState((state) => {
    const versions = { ...state.versions }
    for (const key of keys) versions[key]++
    return { versions }
  })
}

export interface DataState<T> {
  data: T | undefined
  loading: boolean
  error: string | null
  reload(): void
}

/**
 * Loads data from the main process and reloads it when `deps` change or one of `keys` is
 * invalidated. The previous value stays visible while a reload is in flight.
 */
export function useData<T>(keys: DataKey[], fetcher: () => Promise<T>, deps: unknown[] = []): DataState<T> {
  const stamp = useVersions((state) => keys.map((key) => state.versions[key]).join('.'))
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: string | null }>({
    data: undefined,
    loading: true,
    error: null
  })
  const [tick, setTick] = useState(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    let cancelled = false
    setState((previous) => ({ ...previous, loading: true }))
    fetcherRef.current().then(
      (data) => !cancelled && setState({ data, loading: false, error: null }),
      (error: unknown) =>
        !cancelled && setState((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'Failed to load.' }))
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, tick, ...deps])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  return { ...state, reload }
}
