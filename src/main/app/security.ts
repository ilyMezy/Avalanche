import type { Session, WebContents } from 'electron'

const LOCAL_PROTOCOLS = new Set(['file:', 'devtools:', 'data:', 'blob:', 'about:', 'chrome:'])

/**
 * Network egress control: the application is offline by design, so every request that is not
 * a local resource is cancelled. In development the Vite dev server (localhost) is allowed.
 * All permission requests (camera, geolocation, notifications from web content, …) are denied.
 */
export function hardenSession(session: Session, devServerUrl: string | undefined): void {
  const devHost = devServerUrl ? new URL(devServerUrl).host : null
  const isAllowed = (rawUrl: string): boolean => {
    try {
      const url = new URL(rawUrl)
      return LOCAL_PROTOCOLS.has(url.protocol) || (devHost !== null && url.host === devHost)
    } catch {
      return false
    }
  }
  session.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowed(details.url)
    if (!allowed) console.warn(`Blocked network request to ${details.url}`)
    callback({ cancel: !allowed })
  })
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
}

/** The window may never navigate away from the app, open new windows, or host webviews. */
export function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

/** Only web and mail links may be handed to the operating system, never file: or custom schemes. */
export function isSafeExternalUrl(raw: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(raw).protocol)
  } catch {
    return false
  }
}
