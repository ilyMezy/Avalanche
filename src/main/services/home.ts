import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { HOME_IMAGE_ID, normalizeHome, usedImages, type HomeConfig } from '@shared/domain/home'
import { uuidv7 } from '@shared/domain/uuid'
import { AppError } from '@shared/errors'
import type { AppContext } from './context'
import type { SettingsService } from './settings'

const KEY = 'home'
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

/**
 * The Home page's layout, goals, and the user's own pictures. The layout and goals are one
 * JSON value in the settings table. Pictures are copied into the profile (`home-images/`), so
 * the page does not depend on where the original file was, and are named by a generated id:
 * the renderer never supplies a path.
 */
export class HomeService {
  private readonly imageDir: string

  constructor(
    ctx: AppContext,
    private readonly settings: SettingsService
  ) {
    this.imageDir = path.join(ctx.userDataPath, 'home-images')
  }

  get(): HomeConfig {
    return normalizeHome(this.settings.getRaw<unknown>(KEY))
  }

  /** Saves the layout and removes stored pictures that no widget uses any more. */
  async save(config: HomeConfig): Promise<HomeConfig> {
    const next = normalizeHome(config)
    this.settings.setRaw(KEY, next)
    const used = usedImages(next)
    const stored = await fsp.readdir(this.imageDir).catch(() => [] as string[])
    for (const name of stored) {
      // Only this service's own files, one at a time; anything else in the folder is left alone.
      if (HOME_IMAGE_ID.test(name) && !used.has(name)) await fsp.unlink(path.join(this.imageDir, name)).catch(() => undefined)
    }
    return next
  }

  /** Copies a picture the user chose into the profile and returns its id. */
  async importImage(sourcePath: string): Promise<string> {
    const extension = path.extname(sourcePath).toLowerCase()
    if (!MIME[extension]) throw new AppError('INVALID_INPUT', 'Pictures must be PNG, JPEG, GIF, or WebP files.')
    const stat = await fsp.stat(sourcePath).catch(() => null)
    if (!stat?.isFile()) throw new AppError('NOT_FOUND', 'That picture could not be read.')
    if (stat.size > MAX_IMAGE_BYTES) throw new AppError('INVALID_INPUT', 'Pictures for the Home page are limited to 8 MB.')
    await fsp.mkdir(this.imageDir, { recursive: true })
    const id = `${uuidv7()}${extension}`
    await fsp.copyFile(sourcePath, path.join(this.imageDir, id), fs.constants.COPYFILE_EXCL)
    return id
  }

  /** A stored picture as a data URL, or null when it no longer exists. */
  async image(id: string): Promise<string | null> {
    if (!HOME_IMAGE_ID.test(id)) throw new AppError('INVALID_INPUT', 'That is not a Home picture.')
    const data = await fsp.readFile(path.join(this.imageDir, id)).catch(() => null)
    if (!data) return null
    return `data:${MIME[path.extname(id)]};base64,${data.toString('base64')}`
  }
}
