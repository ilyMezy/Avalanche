import { AppError } from '@shared/errors'
import { parseReleases, VERSION_PATTERN, type ReleaseInfo } from '@shared/domain/versions'
import type { UpdateState } from '@shared/types'

// Finding, downloading, and installing a newer version. This is the one place the application
// talks to the internet, and it does so only from the main process: a request to the project's
// release host for the update manifest and, if the user asks for it, the installer. The
// renderer and every document stay offline. No document content, file name, or identifier
// leaves the computer.
//
// The class is written against a small interface so it can be tested without Electron; the real
// updater (electron-updater) is attached in `app/updater.ts`.

export interface UpdateInfoLike {
  version: string
  releaseNotes?: string | { note: string | null }[] | null
}

export interface UpdaterLike {
  on(event: 'update-available' | 'update-not-available' | 'update-downloaded', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
  /** Points the updater at one published version (going back is then allowed), or back at the newest with null. */
  useVersion(version: string | null): void
  /** The release host's list of releases, as parsed JSON. */
  fetchReleases(): Promise<unknown>
}

export interface UpdateOptions {
  currentVersion: string
  /** The updater, or null in builds where updating cannot work (development, test profiles). */
  updater: UpdaterLike | null
  disabledReason: string
  /** Whether the user allows checks the app starts on its own. */
  automatic(): boolean
  emit(state: UpdateState): void
  now(): number
}

const MAX_NOTES = 4000
export const AUTO_CHECK_DELAY_MS = 15_000
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Release notes arrive as HTML or as a list; they are shown as plain text only. */
export function plainNotes(notes: UpdateInfoLike['releaseNotes']): string {
  const raw = Array.isArray(notes) ? notes.map((entry) => entry.note ?? '').join('\n\n') : (notes ?? '')
  return raw
    .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_NOTES)
}

export class UpdateService {
  private current: UpdateState
  /** True while a check the user asked for is running, so its failure is reported to them. */
  private manual = false
  /** True while the updater is pointed at a chosen version instead of the newest. */
  private pinned = false
  private timers: ReturnType<typeof setTimeout>[] = []

  constructor(private readonly options: UpdateOptions) {
    this.current = {
      status: options.updater ? 'idle' : 'disabled',
      currentVersion: options.currentVersion,
      version: null,
      notes: '',
      percent: 0,
      message: options.updater ? '' : options.disabledReason,
      checkedAt: null
    }
    const updater = options.updater
    if (!updater) return
    updater.on('update-available', (info) => this.set({ status: 'available', version: info.version, notes: plainNotes(info.releaseNotes), message: '', checkedAt: options.now() }))
    updater.on('update-not-available', () => this.set({ status: 'up-to-date', version: null, notes: '', message: '', checkedAt: options.now() }))
    updater.on('download-progress', (progress) => this.set({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(progress.percent))) }))
    updater.on('update-downloaded', (info) => this.set({ status: 'ready', version: info.version, percent: 100, message: '' }))
    updater.on('error', (error) => this.fail(error))
  }

  private set(patch: Partial<UpdateState>): void {
    this.current = { ...this.current, ...patch }
    this.options.emit(this.current)
  }

  /**
   * A check the app started by itself fails quietly (being offline is normal for this app);
   * one the user asked for says what happened.
   */
  private fail(error: unknown): void {
    const wasDownloading = this.status() === 'downloading'
    if (!this.manual && !wasDownloading) {
      this.set({ status: this.current.version ? 'available' : 'idle', message: '' })
      return
    }
    this.manual = false
    const detail = error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : ''
    this.set({
      status: 'error',
      percent: 0,
      message: wasDownloading ? `The update could not be downloaded. ${detail}`.trim() : `Could not check for updates. Check your internet connection and try again. ${detail}`.trim()
    })
  }

  /** Read through a method so a status changed by an updater event during an await is seen. */
  private status(): UpdateState['status'] {
    return this.current.status
  }

  state(): UpdateState {
    return this.current
  }

  /** Starts the automatic checks: one shortly after launch, then every few hours while running. */
  start(): void {
    if (!this.options.updater) return
    const run = (): void => {
      if (this.options.automatic()) void this.check(false)
      this.timers = [setTimeout(run, AUTO_CHECK_INTERVAL_MS)]
    }
    this.timers = [setTimeout(run, AUTO_CHECK_DELAY_MS)]
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  async check(manual: boolean): Promise<UpdateState> {
    const updater = this.options.updater
    if (!updater) return this.current
    // A download in progress or a finished one is not thrown away by a new check.
    if (this.status() === 'checking' || this.status() === 'downloading' || this.status() === 'ready') return this.current
    // An ordinary check always looks for the newest version again.
    if (this.pinned && this.status() !== 'idle') {
      updater.useVersion(null)
      this.pinned = false
    }
    this.manual = manual
    this.set({ status: 'checking', message: '' })
    try {
      await updater.checkForUpdates()
    } catch (error) {
      if (this.status() === 'checking') this.fail(error)
    }
    this.manual = false
    // A checker that neither reported a result nor failed leaves the state where it was found.
    if (this.status() === 'checking') this.set({ status: this.current.version ? 'available' : 'idle' })
    return this.current
  }

  async download(): Promise<void> {
    const updater = this.options.updater
    if (!updater || this.status() !== 'available') throw new AppError('INVALID_INPUT', 'There is no update to download.')
    this.set({ status: 'downloading', percent: 0, message: '' })
    try {
      await updater.downloadUpdate()
    } catch (error) {
      if (this.status() === 'downloading') this.fail(error)
    }
  }

  /** Every published version with its notes, newest first, marked against the one installed. */
  async releases(): Promise<ReleaseInfo[]> {
    const updater = this.options.updater
    if (!updater) throw new AppError('INVALID_INPUT', this.options.disabledReason)
    try {
      return parseReleases(await updater.fetchReleases(), this.options.currentVersion)
    } catch {
      throw new AppError('IO_ERROR', 'The list of versions could not be loaded. Check your internet connection and try again.')
    }
  }

  /**
   * Looks for one particular version, newer or older, so it can be downloaded and installed
   * like any update. Checking again afterwards goes back to looking for the newest.
   */
  async switchTo(version: string): Promise<UpdateState> {
    const updater = this.options.updater
    if (!updater) throw new AppError('INVALID_INPUT', this.options.disabledReason)
    if (!VERSION_PATTERN.test(version) || version === this.options.currentVersion) throw new AppError('INVALID_INPUT', 'Choose a version other than the one installed.')
    if (this.status() === 'downloading') throw new AppError('INVALID_INPUT', 'Wait for the current download to finish.')
    updater.useVersion(version)
    this.pinned = true
    this.set({ status: 'idle', version: null, notes: '', percent: 0, message: '' })
    const result = await this.check(true)
    // The manifest of an older release names that release; anything else means it was not found.
    if (result.status === 'up-to-date' || (result.status === 'available' && result.version !== version)) {
      updater.useVersion(null)
      this.pinned = false
      this.set({ status: 'error', version: null, message: `Version ${version} cannot be installed from here: its release does not include the installer files.` })
    }
    return this.current
  }

  /** Closes the app and runs the downloaded installer. The renderer saves open documents first. */
  install(): void {
    const updater = this.options.updater
    if (!updater || this.status() !== 'ready') throw new AppError('INVALID_INPUT', 'The update has not finished downloading.')
    updater.quitAndInstall()
  }
}
