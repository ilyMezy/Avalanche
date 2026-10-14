import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/errors'
import { tiptapToPlainText } from '@shared/domain/text'
import { splitExtension } from '@shared/domain/naming'
import { DEFAULT_THEME, imageElement, presentationText, type Presentation } from '@shared/domain/slides'
import { uuidv7 } from '@shared/domain/uuid'
import type { DocxDocument, Entry, EntryKind, SaveResult, SlidesDocument, TextDocument, TiptapNode } from '@shared/types'
import { hashOf, readIfExists, safeWriteFile } from '../infrastructure/fs/safe-write'
import type { AppContext } from './context'
import type { WorkspaceService } from './workspace'

const MAX_PDF_BYTES = 200 * 1024 * 1024
// The Word and PowerPoint libraries are large; each is loaded the first time it is needed.
const docxExport = () => import('./docx/export')
const docxImport = () => import('./docx/import')
const pptxExport = () => import('./slides/export')
const pptxImport = () => import('./slides/import')

const CONFLICT_MESSAGE = 'The file was changed on disk by another program.'

/** Reads and writes document content. Content always lives in files inside the workspace. */
export class DocumentsService {
  constructor(
    private readonly ctx: AppContext,
    private readonly workspace: WorkspaceService
  ) {}

  private resolve(id: string, kind: EntryKind): { entry: Entry; abs: string } {
    const entry = this.workspace.getRequired(id)
    if (entry.kind !== kind) throw new AppError('INVALID_INPUT', 'This item cannot be opened in that editor.')
    return { entry, abs: this.workspace.absOf(entry.relPath) }
  }

  /**
   * Conflict detection (WS-30, WS-31): immediately before a write, the bytes on disk must
   * still hash to the version the editor loaded. Otherwise another program changed the file
   * and the save is refused unless the user explicitly chooses to overwrite.
   */
  private async assertUnchanged(abs: string, baseVersion: string, force: boolean): Promise<Buffer | null> {
    const current = await readIfExists(abs)
    if (force) return current
    if (!current) throw new AppError('NOT_FOUND', 'The file was moved or deleted outside the app.')
    if (hashOf(current) !== baseVersion) throw new AppError('CONFLICT', CONFLICT_MESSAGE)
    return current
  }

  async readText(id: string): Promise<TextDocument> {
    const { abs } = this.resolve(id, 'markdown')
    const data = await readIfExists(abs)
    if (!data) throw new AppError('NOT_FOUND', 'The file was moved or deleted outside the app.')
    return { content: data.toString('utf8'), version: hashOf(data) }
  }

  async writeText(id: string, content: string, baseVersion: string, force: boolean): Promise<SaveResult> {
    const { abs } = this.resolve(id, 'markdown')
    await this.assertUnchanged(abs, baseVersion, force)
    // The text is saved exactly as typed: no reformatting and no line-ending changes (MD-14).
    const data = Buffer.from(content, 'utf8')
    await safeWriteFile(abs, data)
    await this.workspace.reindex(id, content)
    return { version: hashOf(data), modifiedAt: this.ctx.now() }
  }

  async readDocx(id: string): Promise<DocxDocument> {
    const { abs } = this.resolve(id, 'docx')
    const data = await readIfExists(abs)
    if (!data) throw new AppError('NOT_FOUND', 'The file was moved or deleted outside the app.')
    const imported = await (await docxImport()).readDocxBuffer(data)
    return { doc: imported.doc, html: imported.html, version: hashOf(data), importWarnings: imported.warnings }
  }

  async writeDocx(id: string, doc: TiptapNode, baseVersion: string, force: boolean): Promise<SaveResult> {
    const { entry, abs } = this.resolve(id, 'docx')
    const current = await this.assertUnchanged(abs, baseVersion, force)
    if (current) {
      const { readDocxBuffer } = await docxImport()
      const imported = await readDocxBuffer(current).catch(() => null)
      if (imported && !imported.native) await this.preserveOriginal(entry, current, '.docx')
    }
    const data = await (await docxExport()).buildDocxBuffer(doc)
    await safeWriteFile(abs, data)
    await this.workspace.reindex(id, tiptapToPlainText(doc))
    return { version: hashOf(data), modifiedAt: this.ctx.now() }
  }

  async readSlides(id: string): Promise<SlidesDocument> {
    const { abs } = this.resolve(id, 'slides')
    const data = await readIfExists(abs)
    if (!data) throw new AppError('NOT_FOUND', 'The file was moved or deleted outside the app.')
    const imported = await (await pptxImport()).readPptxBuffer(data)
    return { presentation: imported.presentation, version: hashOf(data), imported: !imported.native, importWarnings: imported.warnings }
  }

  async writeSlides(id: string, presentation: Presentation, baseVersion: string, force: boolean): Promise<SaveResult> {
    const { entry, abs } = this.resolve(id, 'slides')
    const current = await this.assertUnchanged(abs, baseVersion, force)
    if (current) {
      const { readPptxBuffer } = await pptxImport()
      const imported = await readPptxBuffer(current).catch(() => null)
      if (imported && !imported.native) await this.preserveOriginal(entry, current, '.pptx')
    }
    const data = await (await pptxExport()).buildPptxBuffer(presentation)
    await safeWriteFile(abs, data)
    await this.workspace.reindex(id, presentationText(presentation))
    return { version: hashOf(data), modifiedAt: this.ctx.now() }
  }

  /** The bytes of a PDF in the workspace, for the in-app viewer. */
  async readPdf(id: string): Promise<Uint8Array> {
    const { abs } = this.resolve(id, 'pdf')
    const stat = await fsp.stat(abs).catch(() => null)
    if (!stat) throw new AppError('NOT_FOUND', 'The file was moved or deleted outside the app.')
    if (stat.size > MAX_PDF_BYTES) throw new AppError('INVALID_INPUT', 'This PDF is too large to open here.')
    return new Uint8Array(await fsp.readFile(abs))
  }

  /**
   * Creates an editable presentation beside a PDF: one slide per page, each page a full-slide
   * picture that the renderer rasterized. The PDF is not modified.
   */
  async slidesFromPdf(id: string, width: number, height: number, pages: string[]): Promise<Entry> {
    const { entry } = this.resolve(id, 'pdf')
    const presentation: Presentation = {
      width,
      height,
      theme: DEFAULT_THEME,
      slideNumbers: false,
      slides: pages.map((src) => ({ id: uuidv7(), background: '#ffffff', notes: '', elements: [imageElement(src, { x: 0, y: 0, w: width, h: height })] }))
    }
    return this.workspace.createDocument(entry.parentPath, splitExtension(entry.name).stem, 'slides', 'article', presentation)
  }

  /**
   * Before the first save over a file that another program wrote, the original bytes are kept
   * in the app's recovery area, because converting it may drop unsupported content (DOCX-23).
   */
  private async preserveOriginal(entry: Entry, current: Buffer, extension: string): Promise<void> {
    const dir = path.join(this.ctx.userDataPath, 'recovery', 'originals')
    await fsp.mkdir(dir, { recursive: true })
    const target = path.join(dir, `${entry.id}-${hashOf(current).slice(0, 12)}${extension}`)
    if (!fs.existsSync(target)) await fsp.writeFile(target, current)
  }
}
