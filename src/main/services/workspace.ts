import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import {
  baseName,
  displayTitle,
  foldName,
  isOpenable,
  isSameOrInside,
  joinRel,
  kindFromFileName,
  OPENABLE_KINDS,
  parentOf,
  splitExtension,
  uniqueName,
  validateName
} from '@shared/domain/naming'
import { emptyPresentation, type Presentation } from '@shared/domain/slides'
import { FREQUENCY_WINDOW_DAYS, frequencyScore, rankQuickOpen } from '@shared/domain/ranking'
import { uuidv7 } from '@shared/domain/uuid'
import type { DocumentKind, Entry, EntryKind, FolderNode, FrequentDoc, QuickNote, SearchHit, TrashItem } from '@shared/types'
import { docOpens, entries, trashItems, workspaces } from '../infrastructure/db/schema'
import type { AppContext } from './context'
import { createLatexProjectFiles, MANIFEST_NAME } from './latex'
import type { SettingsService } from './settings'

type Row = typeof entries.$inferSelect

const TRASH_DIR = 'trash'
const FREQUENT_LIMIT = 7
const MARKER_DIR = '.offlineworkspace'
const MARKER_FILE = 'workspace.json'
const MAX_INDEXED_CHARS = 200_000
const IMPORTABLE_EXTENSIONS = new Set(['.pptx', '.pdf', '.docx', '.md'])
const MAX_IMPORT_FILES = 50
const MAX_IMPORT_FILE_BYTES = 200 * 1024 * 1024

function toEntry(row: Row): Entry {
  return {
    id: row.id,
    name: row.name,
    relPath: row.relPath,
    parentPath: row.parentPath,
    kind: row.kind as EntryKind,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
    modifiedAt: row.modifiedAt,
    isFavorite: row.isFavorite,
    isPinned: row.isPinned,
    lastOpenedAt: row.lastOpenedAt
  }
}

const isVisible = (name: string): boolean => !name.startsWith('.') && !name.startsWith('~$')

/**
 * The folder-based workspace. Files and directories on disk are the source of truth for
 * content and structure; the `fs_entry` table is an index of them that also carries the
 * metadata the filesystem cannot (favorites, pins, recents, extracted search text).
 */
export class WorkspaceService {
  private workspaceId = ''
  private rootPath = ''

  constructor(
    private readonly ctx: AppContext,
    private readonly settings: SettingsService
  ) {}

  get root(): string {
    return this.rootPath
  }

  /**
   * Opens the configured workspace folder, creating it and its marker file when missing.
   * `overridePath` opens another folder for this session without changing the saved setting.
   */
  async open(overridePath?: string): Promise<void> {
    this.rootPath = path.resolve(overridePath ?? this.settings.get().workspacePath)
    await fsp.mkdir(path.join(this.rootPath, MARKER_DIR), { recursive: true })
    const markerPath = path.join(this.rootPath, MARKER_DIR, MARKER_FILE)
    let marker: { id?: string } = {}
    try {
      marker = JSON.parse(await fsp.readFile(markerPath, 'utf8'))
    } catch {
      // No marker yet (new workspace) or unreadable: a new identity is written below.
    }
    if (typeof marker.id !== 'string' || marker.id.length < 8) {
      marker = { id: uuidv7() }
      await fsp.writeFile(markerPath, JSON.stringify({ id: marker.id, createdAt: this.ctx.now() }, null, 2))
    }
    this.workspaceId = marker.id!
    this.ctx.db
      .insert(workspaces)
      .values({ id: this.workspaceId, rootPath: this.rootPath, createdAt: this.ctx.now() })
      .onConflictDoUpdate({ target: workspaces.id, set: { rootPath: this.rootPath } })
      .run()
  }

  /**
   * Resolves a workspace-relative path to an absolute one. Every segment must be a valid,
   * visible name, so `..`, absolute paths, and dot-folders can never be addressed (ARC-13).
   */
  absOf(relPath: string): string {
    if (relPath === '') return this.rootPath
    const segments = relPath.split('/')
    if (segments.some((segment) => validateName(segment) !== null)) {
      throw new AppError('INVALID_INPUT', 'That path is not valid.')
    }
    const abs = path.join(this.rootPath, ...segments)
    const relative = path.relative(this.rootPath, abs)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppError('OUTSIDE_WORKSPACE', 'That path is outside the workspace.')
    }
    return abs
  }

  private inWorkspace = () => eq(entries.workspaceId, this.workspaceId)

  private rowById(id: string): Row | undefined {
    return this.ctx.db.select().from(entries).where(and(this.inWorkspace(), eq(entries.id, id))).get()
  }

  private rowByPath(relPath: string): Row | undefined {
    return this.ctx.db
      .select()
      .from(entries)
      .where(and(this.inWorkspace(), eq(entries.relPathFolded, foldName(relPath))))
      .get()
  }

  get(id: string): Entry | null {
    const row = this.rowById(id)
    return row ? toEntry(row) : null
  }

  getRequired(id: string): Entry {
    const entry = this.get(id)
    if (!entry) throw new AppError('NOT_FOUND', 'That item no longer exists.')
    return entry
  }

  private async requireFolder(relPath: string): Promise<string> {
    const abs = this.absOf(relPath)
    const stat = await fsp.stat(abs).catch(() => null)
    if (!stat?.isDirectory()) throw new AppError('NOT_FOUND', 'That folder no longer exists.')
    if (relPath !== '' && fs.existsSync(path.join(abs, MANIFEST_NAME))) {
      throw new AppError('INVALID_INPUT', 'A LaTeX project cannot contain other documents.')
    }
    return abs
  }

  private async takenNames(absFolder: string): Promise<Set<string>> {
    return new Set((await fsp.readdir(absFolder)).map(foldName))
  }

  // ---- Indexing -----------------------------------------------------------------------

  private async extractText(abs: string, kind: EntryKind): Promise<string> {
    try {
      if (kind === 'markdown') return (await fsp.readFile(abs, 'utf8')).slice(0, MAX_INDEXED_CHARS)
      // The Word and PowerPoint readers are loaded the first time such a file is indexed.
      if (kind === 'docx') return (await (await import('./docx/import')).extractDocxText(await fsp.readFile(abs))).slice(0, MAX_INDEXED_CHARS)
      if (kind === 'slides') return (await (await import('./slides/import')).extractPptxText(await fsp.readFile(abs))).slice(0, MAX_INDEXED_CHARS)
      if (kind === 'latex_project') {
        let text = ''
        const walk = async (dir: string): Promise<void> => {
          for (const item of await fsp.readdir(dir, { withFileTypes: true })) {
            if (item.name.startsWith('.') || text.length >= MAX_INDEXED_CHARS) continue
            const child = path.join(dir, item.name)
            if (item.isDirectory()) {
              if (item.name !== 'output') await walk(child)
            } else if (/\.(tex|bib)$/i.test(item.name)) {
              text += (await fsp.readFile(child, 'utf8')) + '\n'
            }
          }
        }
        await walk(abs)
        return text.slice(0, MAX_INDEXED_CHARS)
      }
    } catch {
      // Unreadable content is simply not searchable; the entry itself is still listed.
    }
    return ''
  }

  private deleteRows(relPath: string): void {
    const folded = foldName(relPath)
    const prefix = folded + '/'
    this.ctx.db
      .delete(entries)
      .where(
        and(
          this.inWorkspace(),
          sql`(${entries.relPathFolded} = ${folded} OR substr(${entries.relPathFolded}, 1, ${prefix.length}) = ${prefix})`
        )
      )
      .run()
  }

  /** Brings the index of one folder (optionally its whole subtree) in line with the disk. */
  async syncFolder(parentPath: string, recursive: boolean): Promise<void> {
    const abs = this.absOf(parentPath)
    let items: fs.Dirent[]
    try {
      items = (await fsp.readdir(abs, { withFileTypes: true })).filter((item) => isVisible(item.name))
    } catch {
      if (parentPath !== '') this.deleteRows(parentPath)
      return
    }
    const rows = this.ctx.db.select().from(entries).where(and(this.inWorkspace(), eq(entries.parentPath, parentPath))).all()
    const byName = new Map(rows.map((row) => [foldName(row.name), row]))
    const onDisk = new Set<string>()
    const subfolders: string[] = []

    for (const item of items) {
      if (validateName(item.name) !== null) continue
      const childAbs = path.join(abs, item.name)
      const stat = await fsp.stat(childAbs).catch(() => null)
      if (!stat) continue
      const kind: EntryKind = stat.isDirectory()
        ? fs.existsSync(path.join(childAbs, MANIFEST_NAME))
          ? 'latex_project'
          : 'folder'
        : kindFromFileName(item.name)
      const folded = foldName(item.name)
      onDisk.add(folded)
      const relPath = joinRel(parentPath, item.name)
      const modifiedAt = Math.round(stat.mtimeMs)
      const sizeBytes = stat.isDirectory() ? 0 : stat.size
      const existing = byName.get(folded)

      if (!existing) {
        this.ctx.db
          .insert(entries)
          .values({
            id: uuidv7(),
            workspaceId: this.workspaceId,
            parentPath,
            name: item.name,
            relPath,
            relPathFolded: foldName(relPath),
            kind,
            sizeBytes,
            createdAt: Math.round(stat.birthtimeMs) || modifiedAt,
            modifiedAt,
            indexedAt: this.ctx.now(),
            searchText: await this.extractText(childAbs, kind)
          })
          .onConflictDoNothing()
          .run()
      } else if (existing.modifiedAt !== modifiedAt || existing.sizeBytes !== sizeBytes || existing.kind !== kind || existing.name !== item.name) {
        this.ctx.db
          .update(entries)
          .set({ name: item.name, relPath, kind, sizeBytes, modifiedAt, indexedAt: this.ctx.now(), searchText: await this.extractText(childAbs, kind) })
          .where(eq(entries.id, existing.id))
          .run()
      }
      if (kind === 'folder') subfolders.push(relPath)
    }

    for (const row of rows) {
      if (!onDisk.has(foldName(row.name))) this.deleteRows(row.relPath)
    }
    if (recursive) for (const sub of subfolders) await this.syncFolder(sub, true)
  }

  async rescan(): Promise<void> {
    await this.syncFolder('', true)
    this.ctx.db.update(workspaces).set({ lastScannedAt: this.ctx.now() }).where(eq(workspaces.id, this.workspaceId)).run()
  }

  /** Re-reads one entry's size, modification time, and searchable text from disk. */
  async reindex(id: string, knownText?: string): Promise<void> {
    const entry = this.getRequired(id)
    const abs = this.absOf(entry.relPath)
    const stat = await fsp.stat(abs).catch(() => null)
    if (!stat) return
    this.ctx.db
      .update(entries)
      .set({
        sizeBytes: stat.isDirectory() ? 0 : stat.size,
        modifiedAt: Math.round(stat.mtimeMs),
        indexedAt: this.ctx.now(),
        searchText: (knownText ?? (await this.extractText(abs, entry.kind))).slice(0, MAX_INDEXED_CHARS)
      })
      .where(eq(entries.id, id))
      .run()
  }

  private async indexNew(parentPath: string, name: string): Promise<Entry> {
    await this.syncFolder(parentPath, false)
    const row = this.rowByPath(joinRel(parentPath, name))
    if (!row) throw new AppError('IO_ERROR', 'The new item could not be indexed.')
    return toEntry(row)
  }

  // ---- Reading ------------------------------------------------------------------------

  async list(parentPath: string): Promise<Entry[]> {
    await this.requireFolder(parentPath)
    await this.syncFolder(parentPath, false)
    return this.ctx.db.select().from(entries).where(and(this.inWorkspace(), eq(entries.parentPath, parentPath))).all().map(toEntry)
  }

  tree(): FolderNode[] {
    const folders = this.ctx.db.select().from(entries).where(and(this.inWorkspace(), eq(entries.kind, 'folder'))).all()
    const nodes = new Map<string, FolderNode>()
    for (const row of folders) nodes.set(row.relPath, { id: row.id, name: row.name, relPath: row.relPath, children: [] })
    const roots: FolderNode[] = []
    for (const row of folders) {
      const node = nodes.get(row.relPath)!
      const parent = nodes.get(row.parentPath)
      if (parent) parent.children.push(node)
      else if (row.parentPath === '') roots.push(node)
    }
    const sort = (list: FolderNode[]): void => {
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      list.forEach((node) => sort(node.children))
    }
    sort(roots)
    return roots
  }

  private get notesFolder(): string {
    return this.settings.get().quickNotesFolder
  }

  recents(limit: number, scope: 'documents' | 'notes'): Entry[] {
    const notesFolder = this.notesFolder
    return this.ctx.db
      .select()
      .from(entries)
      .where(and(this.inWorkspace(), isNotNull(entries.lastOpenedAt)))
      .orderBy(desc(entries.lastOpenedAt))
      .limit(300)
      .all()
      .filter((row) => {
        const isNote = row.kind === 'markdown' && isSameOrInside(row.parentPath, notesFolder)
        if (scope === 'notes') return isNote
        return !isNote && isOpenable(row.kind)
      })
      .slice(0, limit)
      .map(toEntry)
  }

  favorites(): Entry[] {
    return this.ctx.db
      .select()
      .from(entries)
      .where(and(this.inWorkspace(), eq(entries.isFavorite, true)))
      .all()
      .map(toEntry)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }

  search(query: string): SearchHit[] {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    const pattern = `%${needle.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
    const rows = this.ctx.db
      .select()
      .from(entries)
      .where(
        and(
          this.inWorkspace(),
          sql`(lower(${entries.name}) LIKE ${pattern} ESCAPE '\\' OR lower(${entries.searchText}) LIKE ${pattern} ESCAPE '\\')`
        )
      )
      .limit(80)
      .all()
    const hits = rows.map((row): SearchHit => {
      if (row.name.toLowerCase().includes(needle)) return { entry: toEntry(row), match: 'name', snippet: null }
      const index = row.searchText.toLowerCase().indexOf(needle)
      const start = Math.max(0, index - 50)
      const snippet = (start > 0 ? '…' : '') + row.searchText.slice(start, index + needle.length + 70).replace(/\s+/g, ' ').trim() + '…'
      return { entry: toEntry(row), match: 'content', snippet }
    })
    return hits.sort((a, b) => Number(b.match === 'name') - Number(a.match === 'name') || b.entry.modifiedAt - a.entry.modifiedAt)
  }

  // ---- Creating -----------------------------------------------------------------------

  async createFolder(parentPath: string, name: string): Promise<Entry> {
    const problem = validateName(name)
    if (problem) throw new AppError('INVALID_INPUT', problem)
    const parentAbs = await this.requireFolder(parentPath)
    const finalName = uniqueName(name, await this.takenNames(parentAbs), false)
    await fsp.mkdir(path.join(parentAbs, finalName))
    return this.indexNew(parentPath, finalName)
  }

  async createDocument(
    parentPath: string,
    name: string,
    kind: DocumentKind,
    latexTemplate: 'article' | 'report' = 'article',
    initialSlides?: Presentation
  ): Promise<Entry> {
    const title = name.trim()
    const fileName = kind === 'docx' ? `${title}.docx` : kind === 'markdown' ? `${title}.md` : kind === 'slides' ? `${title}.pptx` : title
    const problem = validateName(fileName)
    if (problem) throw new AppError('INVALID_INPUT', problem)
    const parentAbs = await this.requireFolder(parentPath)
    // Duplicate names never overwrite: a unique name such as "Essay (2).docx" is used instead,
    // and the files themselves are created with the exclusive `wx` flag.
    const finalName = uniqueName(fileName, await this.takenNames(parentAbs), kind !== 'latex_project')
    const abs = path.join(parentAbs, finalName)
    if (kind === 'docx') {
      const { buildDocxBuffer, emptyDocument } = await import('./docx/export')
      await fsp.writeFile(abs, await buildDocxBuffer(emptyDocument()), { flag: 'wx' })
    } else if (kind === 'markdown') {
      await fsp.writeFile(abs, `# ${title}\n\n`, { flag: 'wx' })
    } else if (kind === 'slides') {
      const { buildPptxBuffer } = await import('./slides/export')
      await fsp.writeFile(abs, await buildPptxBuffer(initialSlides ?? emptyPresentation(title)), { flag: 'wx' })
    } else {
      await fsp.mkdir(abs)
      await createLatexProjectFiles(abs, title, latexTemplate)
    }
    return this.indexNew(parentPath, finalName)
  }

  /**
   * Copies files chosen in a native dialog into a workspace folder. Only the listed document
   * types are accepted, nothing is overwritten (a unique name is used and the copy is
   * exclusive), and the originals are left where they are.
   */
  async importFiles(parentPath: string, sources: string[]): Promise<Entry[]> {
    const parentAbs = await this.requireFolder(parentPath)
    const created: Entry[] = []
    for (const source of sources.slice(0, MAX_IMPORT_FILES)) {
      const name = path.basename(source)
      if (!IMPORTABLE_EXTENSIONS.has(path.extname(name).toLowerCase())) throw new AppError('INVALID_INPUT', `“${name}” is not a type this app opens.`)
      const problem = validateName(name)
      if (problem) throw new AppError('INVALID_INPUT', `“${name}” cannot be added: ${problem}`)
      const stat = await fsp.stat(source).catch(() => null)
      if (!stat?.isFile()) throw new AppError('NOT_FOUND', `“${name}” could not be read.`)
      if (stat.size > MAX_IMPORT_FILE_BYTES) throw new AppError('INVALID_INPUT', `“${name}” is larger than 200 MB.`)
      const finalName = uniqueName(name, await this.takenNames(parentAbs), true)
      await fsp.copyFile(source, path.join(parentAbs, finalName), fs.constants.COPYFILE_EXCL)
      created.push(await this.indexNew(parentPath, finalName))
    }
    return created
  }

  // ---- Quick Notes --------------------------------------------------------------------

  async listNotes(): Promise<QuickNote[]> {
    const folder = this.notesFolder
    if (!fs.existsSync(this.absOf(folder))) return []
    await this.syncFolder('', false)
    await this.syncFolder(folder, true)
    const prefix = foldName(folder) + '/'
    return this.ctx.db
      .select()
      .from(entries)
      .where(and(this.inWorkspace(), eq(entries.kind, 'markdown'), sql`substr(${entries.relPathFolded}, 1, ${prefix.length}) = ${prefix}`))
      .all()
      .map((row) => ({
        ...toEntry(row),
        preview: row.searchText.replace(/^\s*#+\s.*$/m, '').replace(/[#*_`>[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)
      }))
      .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.modifiedAt - a.modifiedAt)
  }

  /** Creates an empty, automatically named note in the Quick Notes folder. */
  async createNote(): Promise<Entry> {
    const folder = this.notesFolder
    const abs = this.absOf(folder)
    await fsp.mkdir(abs, { recursive: true })
    await this.syncFolder('', false)
    const now = new Date(this.ctx.now())
    const pad = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`
    const finalName = uniqueName(`Note ${stamp}.md`, await this.takenNames(abs), true)
    await fsp.writeFile(path.join(abs, finalName), '', { flag: 'wx' })
    return this.indexNew(folder, finalName)
  }

  // ---- Changing -----------------------------------------------------------------------

  /** Updates the index after an entry was renamed or moved on disk, including its descendants. */
  private relocate(row: Row, newParent: string, newName: string): Entry {
    const oldRel = row.relPath
    const newRel = joinRel(newParent, newName)
    const now = this.ctx.now()
    this.ctx.db.transaction((tx) => {
      tx.update(entries)
        .set({ parentPath: newParent, name: newName, relPath: newRel, relPathFolded: foldName(newRel), indexedAt: now })
        .where(eq(entries.id, row.id))
        .run()
      if (row.kind !== 'folder') return
      const prefix = foldName(oldRel) + '/'
      const descendants = tx
        .select()
        .from(entries)
        .where(and(this.inWorkspace(), sql`substr(${entries.relPathFolded}, 1, ${prefix.length}) = ${prefix}`))
        .all()
      for (const child of descendants) {
        const childRel = newRel + child.relPath.slice(oldRel.length)
        const childParent = newRel + child.parentPath.slice(oldRel.length)
        tx.update(entries)
          .set({ relPath: childRel, relPathFolded: foldName(childRel), parentPath: childParent })
          .where(eq(entries.id, child.id))
          .run()
      }
    })
    return this.getRequired(row.id)
  }

  async rename(id: string, requestedName: string): Promise<Entry> {
    const row = this.rowById(id)
    if (!row) throw new AppError('NOT_FOUND', 'That item no longer exists.')
    let newName = requestedName.trim()
    if (row.kind !== 'folder' && row.kind !== 'latex_project') {
      // Documents keep their extension; the user edits only the title.
      const { ext } = splitExtension(row.name)
      if (ext && !newName.toLowerCase().endsWith(ext.toLowerCase())) newName += ext
    }
    const problem = validateName(newName)
    if (problem) throw new AppError('INVALID_INPUT', problem)
    if (newName === row.name) return toEntry(row)
    const parentAbs = this.absOf(row.parentPath)
    if (foldName(newName) !== foldName(row.name) && (await this.takenNames(parentAbs)).has(foldName(newName))) {
      throw new AppError('CONFLICT', `"${newName}" already exists in this folder.`)
    }
    await this.fsRename(path.join(parentAbs, row.name), path.join(parentAbs, newName))
    return this.relocate(row, row.parentPath, newName)
  }

  async move(id: string, targetParentPath: string): Promise<Entry> {
    const row = this.rowById(id)
    if (!row) throw new AppError('NOT_FOUND', 'That item no longer exists.')
    if (foldName(targetParentPath) === foldName(row.parentPath)) return toEntry(row)
    if (row.kind === 'folder' && isSameOrInside(targetParentPath, row.relPath)) {
      throw new AppError('INVALID_INPUT', 'A folder cannot be moved into itself.')
    }
    const targetAbs = await this.requireFolder(targetParentPath)
    // "Keep both": an incoming item never replaces an existing one with the same name.
    const finalName = uniqueName(row.name, await this.takenNames(targetAbs), row.kind !== 'folder' && row.kind !== 'latex_project')
    await this.fsRename(this.absOf(row.relPath), path.join(targetAbs, finalName))
    return this.relocate(row, targetParentPath, finalName)
  }

  private async fsRename(from: string, to: string): Promise<void> {
    try {
      await fsp.rename(from, to)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') throw new AppError('NOT_FOUND', 'That item no longer exists on disk.')
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        throw new AppError('FILE_LOCKED', 'The item is in use by another program. Close it there and try again.')
      }
      throw error
    }
  }

  // ---- Trash ----------------------------------------------------------------------------
  //
  // Deleting moves the item into the workspace's hidden trash folder
  // (`.offlineworkspace/trash/<id>/<name>`) with a single rename, so it is instant, stays on the
  // same volume, and can be restored. Nothing is ever deleted recursively by this app: a rename
  // moves a folder as one unit and never follows a symbolic link or junction inside it, and
  // emptying the trash hands each item to the Windows Recycle Bin rather than erasing it.

  private trashRoot(): string {
    return path.join(this.rootPath, MARKER_DIR, TRASH_DIR)
  }

  /** Moves the item (and anything inside it) to the app's trash and removes it from the index. */
  async delete(id: string): Promise<void> {
    const entry = this.getRequired(id)
    // absOf validates every path segment, so the source can only be inside the workspace.
    const abs = this.absOf(entry.relPath)
    if (fs.existsSync(abs)) {
      const trashId = uuidv7()
      const holder = path.join(this.trashRoot(), trashId)
      await fsp.mkdir(holder, { recursive: true })
      try {
        await this.fsRename(abs, path.join(holder, entry.name))
      } catch (error) {
        await fsp.rmdir(holder).catch(() => undefined)
        throw error
      }
      this.ctx.db
        .insert(trashItems)
        .values({ id: trashId, workspaceId: this.workspaceId, name: entry.name, originalRelPath: entry.relPath, kind: entry.kind, deletedAt: this.ctx.now() })
        .run()
    }
    this.deleteRows(entry.relPath)
  }

  listTrash(): TrashItem[] {
    return this.ctx.db
      .select()
      .from(trashItems)
      .where(eq(trashItems.workspaceId, this.workspaceId))
      .orderBy(desc(trashItems.deletedAt))
      .all()
      .map((row) => ({ id: row.id, name: row.name, originalRelPath: row.originalRelPath, kind: row.kind as EntryKind, deletedAt: row.deletedAt }))
  }

  /** Puts a trashed item back where it was. If that name is taken now, both are kept. */
  async restore(trashId: string): Promise<Entry> {
    const row = this.ctx.db.select().from(trashItems).where(and(eq(trashItems.workspaceId, this.workspaceId), eq(trashItems.id, trashId))).get()
    if (!row) throw new AppError('NOT_FOUND', 'That item is no longer in the trash.')
    const holder = path.join(this.trashRoot(), row.id)
    const source = path.join(holder, row.name)
    if (!fs.existsSync(source)) {
      this.ctx.db.delete(trashItems).where(eq(trashItems.id, row.id)).run()
      throw new AppError('NOT_FOUND', 'The trashed file is missing on disk, so it cannot be restored.')
    }
    const parentPath = parentOf(row.originalRelPath)
    const parentAbs = this.absOf(parentPath)
    await fsp.mkdir(parentAbs, { recursive: true })
    const isFile = row.kind !== 'folder' && row.kind !== 'latex_project'
    const finalName = uniqueName(baseName(row.originalRelPath), await this.takenNames(parentAbs), isFile)
    await this.fsRename(source, path.join(parentAbs, finalName))
    await fsp.rmdir(holder).catch(() => undefined)
    this.ctx.db.delete(trashItems).where(eq(trashItems.id, row.id)).run()
    // The restored item's ancestors may have been recreated just now, so index the path down
    // to it, then the restored folder's own contents.
    let current = ''
    await this.syncFolder('', false)
    for (const segment of parentPath ? parentPath.split('/') : []) {
      current = joinRel(current, segment)
      await this.syncFolder(current, false)
    }
    if (row.kind === 'folder') await this.syncFolder(joinRel(parentPath, finalName), true)
    const restored = this.rowByPath(joinRel(parentPath, finalName))
    if (!restored) throw new AppError('IO_ERROR', 'The restored item could not be indexed.')
    return toEntry(restored)
  }

  /** Sends everything in the app's trash to the Windows Recycle Bin. Returns how many items were sent. */
  async emptyTrash(): Promise<{ count: number }> {
    const items = this.ctx.db.select().from(trashItems).where(eq(trashItems.workspaceId, this.workspaceId)).all()
    let count = 0
    for (const item of items) {
      const holder = path.join(this.trashRoot(), item.id)
      if (fs.existsSync(holder)) await this.ctx.trash(holder)
      this.ctx.db.delete(trashItems).where(eq(trashItems.id, item.id)).run()
      count++
    }
    return { count }
  }

  // ---- Frequent documents and Quick Open ------------------------------------------------

  private isDocumentRow(row: Row): boolean {
    if (!isOpenable(row.kind)) return false
    return !(row.kind === 'markdown' && isSameOrInside(row.parentPath, this.notesFolder))
  }

  /**
   * The sidebar's Frequent list: pinned documents first, then the documents with the highest
   * frequency score (see `frequencyScore`: each open counts 1 and halves every 7 days).
   */
  frequent(): FrequentDoc[] {
    const now = this.ctx.now()
    const since = now - FREQUENCY_WINDOW_DAYS * 86_400_000
    const opens = this.ctx.db
      .select({ entryId: docOpens.entryId, openedAt: docOpens.openedAt })
      .from(docOpens)
      .innerJoin(entries, eq(entries.id, docOpens.entryId))
      .where(and(this.inWorkspace(), gte(docOpens.openedAt, since)))
      .all()
    const byEntry = new Map<string, number[]>()
    for (const open of opens) {
      const list = byEntry.get(open.entryId)
      if (list) list.push(open.openedAt)
      else byEntry.set(open.entryId, [open.openedAt])
    }
    const pinned = this.ctx.db.select().from(entries).where(and(this.inWorkspace(), eq(entries.frequentPinned, true))).all()
    const ids = [...byEntry.keys()]
    const opened = ids.length > 0 ? this.ctx.db.select().from(entries).where(and(this.inWorkspace(), inArray(entries.id, ids))).all() : []
    const rows = new Map<string, Row>()
    for (const row of [...pinned, ...opened]) if (this.isDocumentRow(row)) rows.set(row.id, row)

    return [...rows.values()]
      .map((row) => ({ row, score: frequencyScore(byEntry.get(row.id) ?? [], now) }))
      .sort((a, b) => Number(b.row.frequentPinned) - Number(a.row.frequentPinned) || b.score - a.score || a.row.name.localeCompare(b.row.name))
      .slice(0, Math.max(FREQUENT_LIMIT, pinned.length))
      .map(({ row }) => ({ ...toEntry(row), pinned: row.frequentPinned, missing: !fs.existsSync(this.absOf(row.relPath)) }))
  }

  setFrequentPinned(id: string, value: boolean): void {
    this.getRequired(id)
    this.ctx.db.update(entries).set({ frequentPinned: value }).where(eq(entries.id, id)).run()
  }

  /** Takes a document off the Frequent list by forgetting its open history. The file is untouched. */
  removeFrequent(id: string): void {
    this.ctx.db.update(entries).set({ frequentPinned: false }).where(and(this.inWorkspace(), eq(entries.id, id))).run()
    this.ctx.db.delete(docOpens).where(eq(docOpens.entryId, id)).run()
    // An index row whose file has gone is dropped as well, so the stale entry disappears.
    const row = this.rowById(id)
    if (row && !fs.existsSync(this.absOf(row.relPath))) this.deleteRows(row.relPath)
  }

  /** Quick Open: documents and folders ranked by title match, then by how recently they were opened. */
  quickOpen(query: string): Entry[] {
    const rows = this.ctx.db
      .select()
      .from(entries)
      .where(and(this.inWorkspace(), inArray(entries.kind, ['folder', ...OPENABLE_KINDS])))
      .limit(20_000)
      .all()
    const candidates = rows.map((row) => ({ row, title: displayTitle(row.name, row.kind as EntryKind), lastOpenedAt: row.lastOpenedAt }))
    const pool = query.trim() ? candidates : candidates.filter((candidate) => candidate.lastOpenedAt !== null)
    return rankQuickOpen(pool, query, this.ctx.now(), 30).map((candidate) => toEntry(candidate.row))
  }

  private setFlag(id: string, values: Partial<Pick<Row, 'isFavorite' | 'isPinned' | 'lastOpenedAt'>>): Entry {
    this.getRequired(id)
    this.ctx.db.update(entries).set(values).where(eq(entries.id, id)).run()
    return this.getRequired(id)
  }

  setFavorite(id: string, value: boolean): Entry {
    return this.setFlag(id, { isFavorite: value })
  }

  setPinned(id: string, value: boolean): Entry {
    return this.setFlag(id, { isPinned: value })
  }

  /** Records a real open event: updates "recent" and adds to the history behind "frequent". */
  markOpened(id: string): void {
    const now = this.ctx.now()
    this.setFlag(id, { lastOpenedAt: now })
    this.ctx.db.insert(docOpens).values({ id: uuidv7(), entryId: id, openedAt: now }).run()
    this.ctx.db.delete(docOpens).where(lt(docOpens.openedAt, now - 2 * FREQUENCY_WINDOW_DAYS * 86_400_000)).run()
  }
}
