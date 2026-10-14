import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, Menu, Notification, powerMonitor, session, shell } from 'electron'
import { EVENT_CHANNEL } from '@shared/contracts'
import type { AppEvent } from '@shared/types'
import { chromeColors, titleBarHeight } from './app/chrome'
import { hardenSession, hardenWebContents } from './app/security'
import { openDatabase } from './infrastructure/db/connection'
import { registerIpc } from './ipc/router'
import { ReminderScheduler } from './scheduler/reminder-scheduler'
import type { AppContext } from './services/context'
import { DocumentsService } from './services/documents'
import { FlashcardsService } from './services/flashcards'
import { LatexService } from './services/latex'
import { UpdateService } from './services/updates'
import { HomeService } from './services/home'
import { createUpdater } from './app/updater'
import { PlannerService } from './services/planner'
import { PomodoroService } from './services/pomodoro'
import { SettingsService } from './services/settings'
import { WorkspaceService } from './services/workspace'

const APP_NAME = 'Avalanche'
/** The product's name before it was called Avalanche. Existing data lives under this name. */
const LEGACY_NAME = 'Offline Workspace'
// Technical identifiers keep their original values so that an installed copy upgrades in
// place and Windows keeps associating notifications and shortcuts with the same application.
const APP_ID = 'com.offlineworkspace.app'
const BOUNDS_KEY = 'windowBounds'
const CLOSE_FLUSH_TIMEOUT_MS = 10_000
const DEV_ICON = path.join(app.getAppPath(), 'build', 'icon.png')

// Test and development hooks: an isolated profile and workspace can be supplied through the
// environment so automated runs never touch the user's real data.
if (process.env.OW_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.OW_USER_DATA))
} else {
  // Upgrade path from "Offline Workspace": if a profile from before the rename exists, keep
  // using it in place. Nothing is copied or moved, so there is no step at which data can be lost.
  const legacyProfile = path.join(app.getPath('appData'), LEGACY_NAME)
  if (fs.existsSync(path.join(legacyProfile, 'data', 'app.db'))) app.setPath('userData', legacyProfile)
}

/** `Documents\Avalanche` for new users; the existing `Documents\Offline Workspace` folder when there is one. */
function defaultWorkspaceFolder(): string {
  if (process.env.OW_WORKSPACE) return path.resolve(process.env.OW_WORKSPACE)
  const legacy = path.join(app.getPath('documents'), LEGACY_NAME)
  return fs.existsSync(legacy) ? legacy : path.join(app.getPath('documents'), APP_NAME)
}

let mainWindow: BrowserWindow | null = null
let closing = false
let quitting = false
const IS_MAC = process.platform === 'darwin'
let closeTimer: NodeJS.Timeout | null = null

function emit(event: AppEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(EVENT_CHANNEL, event)
}

function createWindow(settings: SettingsService): BrowserWindow {
  closing = false
  const bounds = settings.getRaw<{ width: number; height: number; x?: number; y?: number; maximized?: boolean }>(BOUNDS_KEY)
  const { theme, accent, uiScale } = settings.get()
  const chrome = chromeColors(theme)
  const win = new BrowserWindow({
    width: bounds?.width ?? 1320,
    height: bounds?.height ?? 860,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    icon: fs.existsSync(DEV_ICON) ? DEV_ICON : undefined,
    backgroundColor: chrome.background,
    // Windows and Linux draw their caption buttons over the right of the top bar; macOS keeps its
    // traffic lights at the top left, in the strip above the sidebar.
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 13 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: chrome.background, symbolColor: chrome.symbol, height: titleBarHeight(uiScale) } }),
    webPreferences: {
      zoomFactor: uiScale,
      preload: path.join(__dirname, '../preload/index.js'),
      additionalArguments: [`--ow-theme=${theme}`, `--ow-accent=${accent}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true
    }
  })
  hardenWebContents(win.webContents)
  // Right-click in a text field: spelling suggestions from the Windows spell checker for an
  // underlined word, and the usual editing commands. The app's own menus handle everything else.
  win.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable && !params.selectionText) return
    const items: Electron.MenuItemConstructorOptions[] = []
    if (params.isEditable && params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 6)) items.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) })
      if (params.dictionarySuggestions.length === 0) items.push({ label: 'No spelling suggestions', enabled: false })
      items.push({ label: `Add “${params.misspelledWord}” to the dictionary`, click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' })
    }
    if (params.isEditable) items.push({ role: 'cut', enabled: params.editFlags.canCut }, { role: 'copy', enabled: params.editFlags.canCopy }, { role: 'paste', enabled: params.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll' })
    else items.push({ role: 'copy' })
    Menu.buildFromTemplate(items).popup({ window: win })
  })
  // Chromium remembers a zoom level per origin; the saved interface size is applied again after
  // every load so the two can never disagree.
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(settings.get().uiScale))
  if (bounds?.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  // Closing first asks the renderer to flush unsaved edits. The renderer answers with
  // `app.closeDecision`: 'proceed' destroys the window; 'hold' keeps it open while the user is
  // asked about changes that could not be saved. The timeout only covers a renderer that
  // never answers at all.
  win.on('close', (event) => {
    event.preventDefault()
    if (closing) return
    closing = true
    const normal = win.getNormalBounds()
    settings.setRaw(BOUNDS_KEY, { ...normal, maximized: win.isMaximized() })
    emit({ type: 'flush-request' })
    closeTimer = setTimeout(() => !win.isDestroyed() && win.destroy(), CLOSE_FLUSH_TIMEOUT_MS)
  })
  win.on('closed', () => {
    mainWindow = null
  })

  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
  }

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  return win
}

async function bootstrap(): Promise<void> {
  const userDataPath = app.getPath('userData')
  const defaultWorkspacePath = defaultWorkspaceFolder()

  const opened = await openDatabase(path.join(userDataPath, 'data'), path.join(app.getAppPath(), 'drizzle'))
  const ctx: AppContext = {
    db: opened.db,
    sqlite: opened.sqlite,
    userDataPath,
    defaultWorkspacePath,
    trash: (absolutePath) => shell.trashItem(absolutePath),
    now: () => Date.now()
  }
  const settings = new SettingsService(ctx)
  const workspace = new WorkspaceService(ctx, settings)
  const documents = new DocumentsService(ctx, workspace)
  const latex = new LatexService(ctx, workspace)
  const flashcards = new FlashcardsService(ctx)
  const planner = new PlannerService(ctx)
  const pomodoro = new PomodoroService(ctx, settings)
  const updates = new UpdateService({
    currentVersion: app.getVersion(),
    ...createUpdater(),
    automatic: () => settings.get().checkForUpdates,
    emit: (state) => emit({ type: 'update-state', state }),
    now: () => Date.now()
  })

  try {
    await workspace.open()
  } catch (error) {
    // The configured folder is unavailable (for example a disconnected drive). The setting is
    // kept as it was; this session falls back to the default location so the app stays usable.
    dialog.showErrorBox(
      'Workspace unavailable',
      `The workspace folder "${settings.get().workspacePath}" could not be opened (${(error as Error).message}). The default location will be used for this session.`
    )
    await workspace.open(defaultWorkspacePath)
  }
  // Startup reconciliation runs in the background; folder views also reconcile on demand.
  void workspace.rescan().then(() => emit({ type: 'workspace-changed' })).catch((error) => console.error('Workspace scan failed', error))

  hardenSession(session.defaultSession,app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL)

  registerIpc({
    settings,
    workspace,
    documents,
    latex,
    flashcards,
    planner,
    pomodoro,
    updates,
    home: new HomeService(ctx, settings),
    sqlite: opened.sqlite,
    databasePath: opened.databasePath,
    backupsPath: opened.backupsPath,
    userDataPath,
    defaultWorkspacePath,
    getWindow: () => mainWindow,
    emit,
    onCloseDecision: (action) => {
      if (closeTimer) clearTimeout(closeTimer)
      closeTimer = null
      if (action === 'hold') closing = false
      else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
    }
  })

  mainWindow = createWindow(settings)

  const scheduler = new ReminderScheduler(planner, ({ reminder, result }) => {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: result === 'missed' ? `Missed reminder: ${reminder.title}` : reminder.title,
        body: result === 'missed' ? `This reminder came due while ${APP_NAME} was not running.` : `Reminder · ${reminder.localTime}`
      })
      notification.on('click', () => {
        mainWindow?.show()
        mainWindow?.focus()
      })
      notification.show()
    }
    emit({ type: 'reminder-fired', reminderId: reminder.id, title: reminder.title, missed: result === 'missed' })
  })
  scheduler.start()
  updates.start()

  // After sleep, anything measured against the clock (reminders, the Pomodoro timer) is
  // re-evaluated straight away instead of waiting for its next tick.
  powerMonitor.on('resume', () => {
    scheduler.tick()
    emit({ type: 'power-resume' })
  })

  const shutDown = (): void => {
    scheduler.stop()
    if (opened.sqlite.open) opened.sqlite.close()
  }
  app.on('window-all-closed', () => {
    // On macOS an app stays running with no window until it is quit; the Dock icon reopens it.
    if (IS_MAC && !quitting) return
    shutDown()
    app.quit()
  })
  app.on('will-quit', shutDown)
  app.on('activate', () => {
    if (!mainWindow) mainWindow = createWindow(settings)
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId(APP_ID)
  // Windows and Linux need no menu bar. macOS does: without one, Cmd+C, Cmd+V, Cmd+Z, and Cmd+Q
  // stop working, because those commands live in the menu there.
  Menu.setApplicationMenu(IS_MAC ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null)
  // Quitting closes the window first; this tells the window-closed handler to carry on and quit.
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      console.error(error)
      dialog.showErrorBox(`${APP_NAME} could not start`, error instanceof Error ? error.message : String(error))
      app.exit(1)
    })
}
