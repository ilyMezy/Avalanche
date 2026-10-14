import { app, session } from 'electron'
import type { UpdaterLike } from '../services/updates'

// Must match the `publish` block in electron-builder.yml.
const RELEASE_OWNER = 'ilymezy'
const RELEASE_REPO = 'Avalanche'

/**
 * The real updater, or null with the reason updating is unavailable in this run.
 *
 * electron-updater reads the release location that electron-builder wrote into the package
 * (`publish` in electron-builder.yml), fetches `latest.yml` from the project's GitHub releases,
 * and checks the installer it downloads against the SHA-512 in that file before running it.
 * It uses its own network session, so the block on the application window's session
 * (`security.ts`) stays exactly as it is.
 */
export function createUpdater(): { updater: UpdaterLike | null; disabledReason: string } {
  if (!app.isPackaged) return { updater: null, disabledReason: 'Updates are only available in the installed app, not in a development build.' }
  // A redirected profile means a test or development run; it must not reach the network.
  if (process.env.OW_USER_DATA) return { updater: null, disabledReason: 'Updates are turned off while the app runs with a redirected profile.' }
  if (process.platform === 'darwin') {
    // macOS only lets an app replace itself when it is signed with an Apple Developer ID.
    return { updater: null, disabledReason: 'On a Mac, updates are installed by hand for now: download the newest version from the Releases page.' }
  }
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    // Only the AppImage can update itself; a .deb is updated through the package manager.
    return { updater: null, disabledReason: 'This copy was installed from a package. Install newer versions the same way, from the Releases page.' }
  }

  // The library is loaded the first time it is used (the first check runs a few seconds after
  // launch), so it adds nothing to start-up. Listeners registered before then are attached on load.
  type AutoUpdater = (typeof import('electron-updater'))['autoUpdater']
  const listeners: [string, (...args: never[]) => void][] = []
  let loading: Promise<AutoUpdater> | null = null
  const load = (): Promise<AutoUpdater> =>
    (loading ??= import('electron-updater').then((module) => {
      const autoUpdater = (module.autoUpdater ?? (module as unknown as { default: typeof module }).default.autoUpdater) as AutoUpdater
      // Nothing is downloaded until the user asks; once downloaded, it installs when the app closes.
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.allowPrerelease = false
      autoUpdater.allowDowngrade = false
      autoUpdater.logger = null
      for (const [event, listener] of listeners) autoUpdater.on(event as never, listener as never)
      return autoUpdater
    }))
  return {
    updater: {
      on: (event: string, listener: (...args: never[]) => void) => listeners.push([event, listener]),
      checkForUpdates: async () => (await load()).checkForUpdates(),
      downloadUpdate: async () => (await load()).downloadUpdate(),
      // Not silent, and the app starts again after the installer finishes.
      quitAndInstall: () => void load().then((autoUpdater) => autoUpdater.quitAndInstall(false, true)),
      useVersion: (version: string | null) =>
        void load().then((autoUpdater) => {
          if (version === null) {
            autoUpdater.allowDowngrade = false
            autoUpdater.setFeedURL({ provider: 'github', owner: RELEASE_OWNER, repo: RELEASE_REPO, releaseType: 'release' })
          } else {
            // Each release carries its own manifest (latest.yml), so pointing the updater at one
            // release's files makes that version the one it finds.
            autoUpdater.allowDowngrade = true
            autoUpdater.setFeedURL({ provider: 'generic', url: `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download/v${version}` })
          }
        }),
      fetchReleases: async () => {
        // Its own session, like the updater's: the window's session stays blocked from the network.
        const response = await session.fromPartition('avalanche-releases', { cache: false }).fetch(`https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases?per_page=50`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Avalanche' }
        })
        if (!response.ok) throw new Error(`Release list request failed (${response.status})`)
        return response.json()
      }
    } as UpdaterLike,
    disabledReason: ''
  }
}
