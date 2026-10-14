import { ArrowDownToLine, History, RefreshCw } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { ReleaseInfo } from '@shared/domain/versions'
import { create } from 'zustand'
import type { UpdateState } from '@shared/types'
import { Button } from '@/components/ui/button'
import { confirmDialog } from '@/components/ui/dialogs'
import { Spinner, toast } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlays'
import { call, errorMessage } from '@/lib/api'
import { flushAll } from '@/lib/useSaver'

// What the window knows about updates. The main process does the checking and downloading; it
// reports its state here and the window only displays it.

export const useUpdates = create<{ state: UpdateState | null }>(() => ({ state: null }))

export function setUpdateState(state: UpdateState): void {
  useUpdates.setState({ state })
}

export async function loadUpdateState(): Promise<void> {
  setUpdateState(await call('updates.state'))
}

export async function checkForUpdates(): Promise<void> {
  try {
    setUpdateState(await call('updates.check'))
  } catch (error) {
    toast(errorMessage(error), 'error')
  }
}

async function download(): Promise<void> {
  await call('updates.download').catch((error) => toast(errorMessage(error), 'error'))
}

/** Saves every open document, then closes the app to run the installer. */
async function install(): Promise<void> {
  await flushAll()
  await call('updates.install').catch((error) => toast(errorMessage(error), 'error'))
}

/** One line describing where things stand, for Settings. */
export function updateSummary(state: UpdateState): string {
  switch (state.status) {
    case 'disabled':
      return state.message
    case 'checking':
      return 'Checking for a newer version…'
    case 'up-to-date':
      return `You have the latest version (${state.currentVersion}).`
    case 'available':
      return `Version ${state.version} is available.`
    case 'downloading':
      return `Downloading version ${state.version}: ${state.percent}%`
    case 'ready':
      return `Version ${state.version} is downloaded and will be installed when you restart.`
    case 'error':
      return state.message
    default:
      return `You are on version ${state.currentVersion}.`
  }
}

/** The buttons that go with the current state: download, restart, or nothing. */
export function UpdateActions({ state }: { state: UpdateState }): ReactNode {
  if (state.status === 'available') {
    return (
      <Button variant="primary" onClick={() => void download()}>
        <ArrowDownToLine size={14} />
        Download update
      </Button>
    )
  }
  if (state.status === 'ready') {
    return (
      <Button variant="primary" onClick={() => void install()}>
        <RefreshCw size={14} />
        Restart to update
      </Button>
    )
  }
  return null
}

/**
 * The notice in the top bar. It appears only when there is something to act on: a newer
 * version, a download in progress, or an update ready to install.
 */
export function UpdatePill(): ReactNode {
  const state = useUpdates((store) => store.state)
  const [open, setOpen] = useState(false)
  if (!state || (state.status !== 'available' && state.status !== 'downloading' && state.status !== 'ready')) return null
  const text = state.status === 'available' ? `Update ${state.version} available` : state.status === 'downloading' ? `Downloading update ${state.percent}%` : 'Restart to update'
  return (
    <>
      <button
        type="button"
        data-testid="update-pill"
        onClick={() => setOpen(true)}
        className="no-drag animate-fade flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-accent/40 bg-accent-soft px-2 text-xs text-accent-text hover:border-accent"
      >
        <ArrowDownToLine size={12} />
        {text}
      </button>
      {open && (
        <Modal
          open
          onOpenChange={(next) => !next && setOpen(false)}
          title={state.status === 'ready' ? `Version ${state.version} is ready to install` : `Version ${state.version} is available`}
          description={`You have version ${state.currentVersion}. ${
            state.status === 'ready'
              ? 'Your open documents are saved before the app restarts.'
              : 'The update is downloaded from the project’s GitHub releases and checked before it is installed. Your documents stay on this computer.'
          }`}
          className="w-[520px]"
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Later</Button>
              {state.status === 'downloading' ? <Button disabled>Downloading {state.percent}%</Button> : <UpdateActions state={state} />}
            </>
          }
        >
          {state.notes ? (
            <div className="selectable max-h-[260px] overflow-y-auto rounded-lg border border-line bg-raised px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap text-muted">{state.notes}</div>
          ) : (
            <p className="text-xs text-subtle">No release notes were published for this version.</p>
          )}
        </Modal>
      )}
    </>
  )
}

const releaseDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Version history: every published version with what changed in it. Any version other than the
 * installed one can be chosen; it is then downloaded and installed like an ordinary update.
 */
export function VersionHistoryButton({ disabled }: { disabled: boolean }): ReactNode {
  const [open, setOpen] = useState(false)
  const [releases, setReleases] = useState<ReleaseInfo[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const state = useUpdates((store) => store.state)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setReleases(null)
    setProblem(null)
    call('updates.releases').then(
      (list) => !cancelled && setReleases(list),
      (error: unknown) => !cancelled && setProblem(errorMessage(error))
    )
    return () => {
      cancelled = true
    }
  }, [open])

  const choose = async (release: ReleaseInfo): Promise<void> => {
    if (release.relation === 'older') {
      const confirmed = await confirmDialog({
        title: `Go back to version ${release.version}?`,
        body: 'An older version may not understand data saved by a newer one: decks, tasks, or settings added since could be missing or fail to open. Your documents are ordinary files and are not affected. A copy of the database is saved every time the app starts (Settings → Data and backup).',
        confirmLabel: `Get version ${release.version}`,
        danger: true
      })
      if (!confirmed) return
    }
    try {
      const next = await call('updates.switchTo', { version: release.version })
      setUpdateState(next)
      if (next.status === 'available') {
        toast(`Version ${release.version} is ready to download from the notice in the top bar.`)
        setOpen(false)
      } else if (next.status === 'error') toast(next.message, 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  return (
    <>
      <Button disabled={disabled} onClick={() => setOpen(true)}>
        <History size={14} />
        Version history
      </Button>
      {open && (
        <Modal
          open
          onOpenChange={(next) => !next && setOpen(false)}
          title="Version history"
          description={`You have version ${state?.currentVersion ?? ''}. The list comes from the project’s GitHub releases.`}
          className="w-[600px]"
          footer={<Button onClick={() => setOpen(false)}>Close</Button>}
        >
          {problem ? (
            <p className="py-6 text-center text-xs text-danger">{problem}</p>
          ) : releases === null ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : releases.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted">No versions have been published yet.</p>
          ) : (
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {releases.map((release) => (
                <div key={release.version} data-testid="release-row" className="rounded-lg border border-line bg-raised p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-fg">{release.name}</span>
                    <span className="text-xs text-subtle">
                      {release.version}
                      {release.publishedAt ? ` · ${releaseDate.format(release.publishedAt)}` : ''}
                    </span>
                    <span className="flex-1" />
                    {release.relation === 'current' ? (
                      <span className="rounded-full bg-accent-soft px-2 py-px text-[11px] text-accent-text">Installed</span>
                    ) : (
                      <Button size="sm" variant={release.relation === 'newer' ? 'primary' : 'secondary'} disabled={!release.installable} title={release.installable ? undefined : 'This release does not include the installer files'} onClick={() => void choose(release)}>
                        {release.relation === 'newer' ? 'Update to this' : 'Go back to this'}
                      </Button>
                    )}
                  </div>
                  {release.notes && <div className="selectable mt-2 text-xs leading-relaxed whitespace-pre-wrap text-muted">{release.notes}</div>}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
