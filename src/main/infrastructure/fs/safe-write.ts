import { createHash, randomBytes } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/errors'

export function hashOf(data: string | Uint8Array): string {
  return createHash('sha1').update(data).digest('hex')
}

function isLockError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
}

/**
 * Safe write (spec 13.5): the new content goes to a temporary file in the same directory,
 * is flushed to disk, and then atomically replaces the target. A crash leaves either the
 * complete old file or the complete new one. Temporary names start with a dot, which the
 * workspace scanner ignores.
 */
export async function safeWriteFile(target: string, data: string | Uint8Array): Promise<void> {
  const tmp = path.join(path.dirname(target), `.~ow-${randomBytes(6).toString('hex')}.tmp`)
  try {
    const handle = await fsp.open(tmp, 'wx')
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fsp.rename(tmp, target)
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined)
    if (isLockError(error)) {
      throw new AppError('FILE_LOCKED', 'Save failed — the file is in use by another program.')
    }
    throw error
  }
}

/** Reads a file, returning null when it does not exist. */
export async function readIfExists(target: string): Promise<Buffer | null> {
  try {
    return await fsp.readFile(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
