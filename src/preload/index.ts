/// <reference lib="dom" />
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNEL_NAMES, EVENT_CHANNEL } from '@shared/channels'
import { normalizeAccent, normalizeTheme, THEMES } from '@shared/themes'

// The renderer never receives `ipcRenderer` or a generic "invoke anything" function. It gets
// one function per channel declared in the shared contract, and nothing else.
const api: Record<string, (request: unknown) => Promise<unknown>> = {}
for (const channel of CHANNEL_NAMES) {
  api[channel] = (request: unknown) => ipcRenderer.invoke(channel, request)
}

// The saved theme arrives as a process argument so the page can apply it synchronously,
// before its first paint, instead of flashing the wrong theme while settings load.
const argument = (name: string): string | undefined => process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1]
const theme = normalizeTheme(argument('ow-theme'))
const accent = normalizeAccent(argument('ow-accent'))

// Applied as soon as the <html> element exists, which is before anything is painted.
const applyTheme = (): void => {
  const root = document.documentElement
  root.classList.add(`theme-${theme}`)
  root.classList.toggle('dark', THEMES[theme].dark)
  if (accent !== 'theme') root.classList.add(`accent-${accent}`)
}
if (document.documentElement) applyTheme()
else {
  const observer = new MutationObserver(() => {
    if (!document.documentElement) return
    observer.disconnect()
    applyTheme()
  })
  observer.observe(document, { childList: true })
}

contextBridge.exposeInMainWorld('boot', Object.freeze({ theme, accent }))
contextBridge.exposeInMainWorld('api', Object.freeze(api))
contextBridge.exposeInMainWorld('appEvents', {
  subscribe(listener: (event: unknown) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, handler)
  }
})
