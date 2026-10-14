import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Spinner } from '@/components/ui/feedback'

/**
 * A component whose code is fetched the first time it is shown, so it is not part of what the
 * app loads at launch.
 *
 * This deliberately does not use `React.lazy` and `Suspense`. A suspended tree is first rendered
 * and then revealed, and the rich-text editor creates its instance during render: by the time its
 * effects ran, that instance had been thrown away. Here the component simply mounts once its
 * module has arrived, like any other.
 */
export function loadable<Props extends object>(load: () => Promise<ComponentType<Props>>): ComponentType<Props> {
  let loaded: ComponentType<Props> | null = null
  let pending: Promise<ComponentType<Props>> | null = null

  return function Loadable(props: Props): ReactNode {
    const [Component, setComponent] = useState<ComponentType<Props> | null>(() => loaded)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
      if (Component) return
      let cancelled = false
      pending ??= load().then((component) => (loaded = component))
      pending.then(
        (component) => !cancelled && setComponent(() => component),
        () => {
          pending = null
          if (!cancelled) setFailed(true)
        }
      )
      return () => {
        cancelled = true
      }
    }, [Component])

    if (Component) return <Component {...props} />
    return <div className="flex h-full items-center justify-center text-xs text-muted">{failed ? 'This part of the app could not be loaded. Restart the app and try again.' : <Spinner />}</div>
  }
}
