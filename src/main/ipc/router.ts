import fsp from 'node:fs/promises'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ZodError } from 'zod'
import { channelNames, contract, type Channel, type ParsedReq, type Res } from '@shared/contracts'
import { AppError, type IpcResult } from '@shared/errors'
import type { AppEvent } from '@shared/types'
import { chromeColors, titleBarHeight } from '../app/chrome'
import { isSafeExternalUrl } from '../app/security'
import { snapshotDatabase } from '../infrastructure/db/connection'
import type { DocumentsService } from '../services/documents'
import type { FlashcardsService } from '../services/flashcards'
import type { HomeService } from '../services/home'
import type { LatexService } from '../services/latex'
import type { PlannerService } from '../services/planner'
import type { PomodoroService } from '../services/pomodoro'
import { exportHtmlToPdf } from '../app/pdf-export'
import { displayTitle } from '@shared/domain/naming'
import { templatePresentation } from '@shared/domain/slides'
import { MAX_IMPORT_BYTES } from '@shared/domain/csv'
import { MODE_LABELS } from '@shared/domain/pomodoro'
import { Notification } from 'electron'
import type { SettingsService } from '../services/settings'
import type { UpdateService } from '../services/updates'
import type { WorkspaceService } from '../services/workspace'

export interface RouterDeps {
  settings: SettingsService
  workspace: WorkspaceService
  documents: DocumentsService
  latex: LatexService
  flashcards: FlashcardsService
  planner: PlannerService
  pomodoro: PomodoroService
  updates: UpdateService
  home: HomeService
  sqlite: Database.Database
  databasePath: string
  backupsPath: string
  userDataPath: string
  defaultWorkspacePath: string
  getWindow(): BrowserWindow | null
  emit(event: AppEvent): void
  onCloseDecision(action: 'proceed' | 'hold'): void
}

type Handlers = { [K in Channel]: (req: ParsedReq<K>) => Res<K> | Promise<Res<K>> }

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' }

function buildHandlers(deps: RouterDeps): Handlers {
  const { settings, workspace, documents, latex, flashcards, planner, pomodoro } = deps
  const requireWindow = (): BrowserWindow => {
    const win = deps.getWindow()
    if (!win) throw new AppError('INTERNAL', 'The window is not available.')
    return win
  }

  return {
    'app.info': () => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      userDataPath: deps.userDataPath,
      databasePath: deps.databasePath,
      backupsPath: deps.backupsPath,
      workspacePath: workspace.root,
      defaultWorkspacePath: deps.defaultWorkspacePath
    }),
    'app.openPath': async ({ target }) => {
      const location = target === 'workspace' ? workspace.root : target === 'backups' ? deps.backupsPath : deps.userDataPath
      await fsp.mkdir(location, { recursive: true })
      await shell.openPath(location)
    },
    'app.openExternal': async ({ url }) => {
      if (!isSafeExternalUrl(url)) throw new AppError('INVALID_INPUT', 'Only web and email links can be opened.')
      // Links leave the app only after an explicit confirmation that shows the full address.
      const { response } = await dialog.showMessageBox(requireWindow(), {
        type: 'question',
        buttons: ['Open link', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Open external link',
        message: 'Open this link in your default browser?',
        detail: url
      })
      if (response !== 0) return false
      await shell.openExternal(url)
      return true
    },
    'app.chooseWorkspace': async () => {
      const result = await dialog.showOpenDialog(requireWindow(), {
        title: 'Choose a workspace folder',
        defaultPath: workspace.root,
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const previous = settings.get().workspacePath
      settings.setRaw('workspacePath', result.filePaths[0])
      try {
        await workspace.open()
        await workspace.rescan()
      } catch (error) {
        settings.setRaw('workspacePath', previous)
        await workspace.open()
        throw new AppError('IO_ERROR', `That folder could not be used as a workspace: ${(error as Error).message}`)
      }
      settings.saveSession({ tabs: [], activeTabId: null })
      deps.emit({ type: 'workspace-changed' })
      return settings.get()
    },
    'app.backupNow': async () => ({ path: await snapshotDatabase(deps.sqlite, deps.backupsPath, 'manual') }),
    'app.setChrome': ({ theme }) => {
      const win = deps.getWindow()
      if (!win) return
      const chrome = chromeColors(theme)
      win.setBackgroundColor(chrome.background)
      if (process.platform !== 'darwin') {
        win.setTitleBarOverlay({ color: chrome.background, symbolColor: chrome.symbol, height: titleBarHeight(settings.get().uiScale) })
      }
    },
    'app.closeDecision': ({ action }) => deps.onCloseDecision(action),

    'updates.state': () => deps.updates.state(),
    'updates.check': () => deps.updates.check(true),
    'updates.download': () => deps.updates.download(),
    'updates.install': () => deps.updates.install(),
    'updates.releases': () => deps.updates.releases(),
    'updates.switchTo': ({ version }) => deps.updates.switchTo(version),

    'home.get': () => deps.home.get(),
    'home.save': (config) => deps.home.save(config),
    'home.pickImage': async () => {
      const result = await dialog.showOpenDialog(requireWindow(), {
        title: 'Choose a picture for Home',
        properties: ['openFile'],
        filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return { imageId: await deps.home.importImage(result.filePaths[0]) }
    },
    'home.image': ({ id }) => deps.home.image(id),

    'settings.get': () => settings.get(),
    'settings.update': (patch) => {
      const next = settings.update(patch)
      const win = deps.getWindow()
      if (patch.uiScale !== undefined && win) {
        // The interface size scales the whole window content, and the native controls with it.
        win.webContents.setZoomFactor(next.uiScale)
        if (process.platform !== 'darwin') win.setTitleBarOverlay({ height: titleBarHeight(next.uiScale) })
      }
      return next
    },
    'session.get': () => settings.getSession(),
    'session.save': (session) => settings.saveSession(session),

    'workspace.list': ({ parentPath }) => workspace.list(parentPath),
    'workspace.tree': () => workspace.tree(),
    'workspace.get': ({ id }) => workspace.get(id),
    'workspace.createFolder': ({ parentPath, name }) => workspace.createFolder(parentPath, name),
    'workspace.createDocument': ({ parentPath, name, kind, template, slidesTemplate }) =>
      workspace.createDocument(parentPath, name, kind, template, kind === 'slides' && slidesTemplate ? templatePresentation(slidesTemplate, name.trim()) : undefined),
    'workspace.importFiles': async ({ parentPath }) => {
      const result = await dialog.showOpenDialog(requireWindow(), {
        title: 'Add files to the workspace',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Slides and documents', extensions: ['pptx', 'pdf', 'docx', 'md'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return []
      return workspace.importFiles(parentPath, result.filePaths)
    },
    'workspace.rename': ({ id, name }) => workspace.rename(id, name),
    'workspace.move': ({ id, targetParentPath }) => workspace.move(id, targetParentPath),
    'workspace.delete': ({ id }) => workspace.delete(id),
    'workspace.setFavorite': ({ id, value }) => workspace.setFavorite(id, value),
    'workspace.setPinned': ({ id, value }) => workspace.setPinned(id, value),
    'workspace.markOpened': ({ id }) => workspace.markOpened(id),
    'workspace.recents': ({ limit, scope }) => workspace.recents(limit, scope),
    'workspace.favorites': () => workspace.favorites(),
    'workspace.frequent': () => workspace.frequent(),
    'workspace.setFrequentPinned': ({ id, value }) => workspace.setFrequentPinned(id, value),
    'workspace.removeFrequent': ({ id }) => workspace.removeFrequent(id),
    'workspace.quickOpen': ({ query }) => workspace.quickOpen(query),
    'workspace.trash': () => workspace.listTrash(),
    'workspace.restore': ({ trashId }) => workspace.restore(trashId),
    'workspace.emptyTrash': () => workspace.emptyTrash(),
    'workspace.search': ({ query }) => workspace.search(query),
    'workspace.rescan': () => workspace.rescan(),
    'workspace.showInFolder': ({ id }) => shell.showItemInFolder(workspace.absOf(workspace.getRequired(id).relPath)),

    'notes.list': () => workspace.listNotes(),
    'notes.create': () => workspace.createNote(),

    'documents.readText': ({ id }) => documents.readText(id),
    'documents.writeText': ({ id, content, baseVersion, force }) => documents.writeText(id, content, baseVersion, force),
    'documents.readDocx': ({ id }) => documents.readDocx(id),
    'documents.writeDocx': ({ id, doc, baseVersion, force }) => documents.writeDocx(id, doc, baseVersion, force),
    'documents.pickImage': async () => {
      const result = await dialog.showOpenDialog(requireWindow(), {
        title: 'Insert image',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const file = result.filePaths[0]
      const mime = IMAGE_MIME[path.extname(file).toLowerCase()]
      if (!mime) throw new AppError('INVALID_INPUT', 'Only PNG, JPEG, and GIF images can be inserted.')
      const data = await fsp.readFile(file)
      if (data.length > MAX_IMAGE_BYTES) throw new AppError('INVALID_INPUT', 'Images are limited to 10 MB.')
      return { dataUrl: `data:${mime};base64,${data.toString('base64')}`, name: path.basename(file) }
    },

    'documents.exportPdf': async ({ id, html }) => {
      const entry = workspace.getRequired(id)
      if (entry.kind !== 'docx') throw new AppError('INVALID_INPUT', 'Only documents can be exported to PDF.')
      const title = displayTitle(entry.name, entry.kind)
      const result = await dialog.showSaveDialog(requireWindow(), {
        title: 'Export as PDF',
        defaultPath: path.join(app.getPath('documents'), `${title}.pdf`),
        filters: [{ name: 'PDF document', extensions: ['pdf'] }]
      })
      if (result.canceled || !result.filePath) return null
      await exportHtmlToPdf(html, title, result.filePath, path.join(deps.userDataPath, 'tmp'))
      return { path: result.filePath }
    },

    'slides.read': ({ id }) => documents.readSlides(id),
    'slides.write': ({ id, presentation, baseVersion, force }) => documents.writeSlides(id, presentation, baseVersion, force),
    'slides.readPdf': ({ id }) => documents.readPdf(id),
    'slides.fromPdf': ({ id, width, height, pages }) => documents.slidesFromPdf(id, width, height, pages),

    'latex.toolchain': () => latex.toolchain(),
    'latex.project': ({ id }) => latex.project(id),
    'latex.readFile': ({ id, file }) => latex.readFile(id, file),
    'latex.writeFile': ({ id, file, content, baseVersion, force }) => latex.writeFile(id, file, content, baseVersion, force),
    'latex.createFile': ({ id, file }) => latex.createFile(id, file),
    'latex.deleteFile': ({ id, file }) => latex.deleteFile(id, file),
    'latex.compile': ({ id }) => latex.compile(id),
    'latex.readPdf': ({ id }) => latex.readPdf(id),

    'flashcards.decks': () => flashcards.listDecks(),
    'flashcards.createDeck': ({ name, parentId }) => flashcards.createDeck(name, parentId ?? null),
    'flashcards.renameDeck': ({ id, name }) => flashcards.renameDeck(id, name),
    'flashcards.moveDeck': ({ id, parentId }) => flashcards.moveDeck(id, parentId),
    'flashcards.deleteDeck': ({ id, mode }) => flashcards.deleteDeck(id, mode),
    'flashcards.moveCards': ({ cardIds, deckId }) => flashcards.moveCards(cardIds, deckId),
    'flashcards.importPick': async () => {
      const result = await dialog.showOpenDialog(requireWindow(), {
        title: 'Import flashcards',
        properties: ['openFile'],
        filters: [
          { name: 'Delimited text', extensions: ['csv', 'tsv', 'txt'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const file = result.filePaths[0]
      const stat = await fsp.stat(file)
      if (stat.size > MAX_IMPORT_BYTES) throw new AppError('INVALID_INPUT', 'That file is larger than 20 MB, which is more than can be imported at once.')
      return { name: path.basename(file), bytes: new Uint8Array(await fsp.readFile(file)) }
    },
    'flashcards.importCards': ({ deckId, cards, duplicates }) => flashcards.importCards(deckId, cards, duplicates),

    'pomodoro.get': () => pomodoro.snapshot(),
    'pomodoro.saveState': ({ state }) => pomodoro.saveState(state),
    'pomodoro.saveSettings': ({ settings: raw }) => pomodoro.saveSettings(raw),
    'pomodoro.logSession': ({ notify, ...session }) => {
      pomodoro.logSession(session)
      if (notify && session.completed && Notification.isSupported()) {
        const next = session.mode === 'focus' ? 'Time for a break.' : 'Ready to focus again.'
        const notification = new Notification({ title: `${MODE_LABELS[session.mode]} finished`, body: next, silent: true })
        notification.on('click', () => {
          deps.getWindow()?.show()
          deps.getWindow()?.focus()
        })
        notification.show()
      }
      return pomodoro.snapshot()
    },
    'flashcards.cards': ({ deckId }) => flashcards.listCards(deckId),
    'flashcards.createCards': ({ deckId, cards, sourceEntryId, sourceExcerpt }) =>
      flashcards.createCards(deckId, cards, sourceEntryId ?? null, sourceExcerpt ?? null),
    'flashcards.updateCard': ({ id, front, back, extra, tags }) => flashcards.updateCard(id, front, back, extra, tags),
    'flashcards.deleteCard': ({ id }) => flashcards.deleteCard(id),
    'flashcards.studyQueue': ({ deckId, includeSubdecks, mode }) => flashcards.studyQueue(deckId, includeSubdecks, mode),
    'flashcards.setDeckStyle': ({ id, icon, color }) => flashcards.setDeckStyle(id, icon, color),
    'flashcards.rate': ({ cardId, rating }) => flashcards.rate(cardId, rating),
    'flashcards.summary': () => flashcards.summary(),

    'planner.tasks': () => planner.listTasks(),
    'planner.saveTask': (input) => planner.saveTask(input),
    'planner.setCompleted': ({ id, completed }) => planner.setCompleted(id, completed),
    'planner.deleteTask': ({ id }) => planner.deleteTask(id),
    'planner.reminders': () => planner.listReminders(),
    'planner.saveReminder': (input) => planner.saveReminder(input),
    'planner.deleteReminder': ({ id }) => planner.deleteReminder(id),
    'planner.acknowledgeReminder': ({ id }) => planner.acknowledgeReminder(id)
  }
}

function toFailure(channel: string, error: unknown): IpcResult<never> {
  if (error instanceof AppError) return { ok: false, error: { code: error.code, message: error.message } }
  if (error instanceof ZodError) {
    console.warn(`Rejected invalid request on ${channel}:`, error.issues)
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'The request was not valid.' } }
  }
  console.error(`Unhandled error on ${channel}:`, error)
  return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } }
}

/**
 * Registers one explicit handler per contract channel. Each call verifies that the sender is
 * the app's own main frame, validates the payload with the channel's Zod schema, and returns
 * a typed result object; stack traces never cross the process boundary.
 */
export function registerIpc(deps: RouterDeps): void {
  const handlers = buildHandlers(deps)
  const isTrusted = (event: IpcMainInvokeEvent): boolean => {
    const win = deps.getWindow()
    return !!win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
  }

  for (const channel of channelNames) {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<unknown>> => {
      if (!isTrusted(event)) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Request rejected.' } }
      try {
        const request = contract[channel].req.parse(raw)
        const handler = handlers[channel] as (req: unknown) => unknown
        return { ok: true, data: await handler(request) }
      } catch (error) {
        return toFailure(channel, error)
      }
    })
  }
}
