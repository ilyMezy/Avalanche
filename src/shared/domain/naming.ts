import type { EntryKind } from '../types'

// File and folder naming rules for Windows (spec Appendix D). Pure functions: no filesystem access.

// Control characters are deliberately part of this pattern: Windows forbids them in names.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS =/[<>:"/\\|?*\u0000-\u001f]/
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** Returns a user-facing explanation when the name is not allowed, or null when it is valid. */
export function validateName(name: string): string | null {
  if (name.length === 0 || name.trim().length === 0) return 'A name is required.'
  if (name.length > 255) return 'Names are limited to 255 characters.'
  if (FORBIDDEN_CHARS.test(name)) return 'Names cannot contain any of these characters: < > : " / \\ | ? *'
  if (/[. ]$/.test(name)) return 'Names cannot end with a space or a dot.'
  if (/^\s/.test(name)) return 'Names cannot start with a space.'
  if (name.startsWith('.')) return 'Names cannot start with a dot.'
  if (RESERVED_NAMES.test(name)) return `"${name}" is reserved by Windows and cannot be used as a name.`
  return null
}

/** Case-insensitive comparison form, matching how Windows treats names. */
export function foldName(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

export function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return { stem: name, ext: '' }
  return { stem: name.slice(0, dot), ext: name.slice(dot) }
}

/**
 * Proposes a name that does not collide with `takenFolded` (a set of folded names):
 * `Essay.docx`, `Essay (2).docx`, `Essay (3).docx`, …
 */
export function uniqueName(desired: string, takenFolded: ReadonlySet<string>, isFile: boolean): string {
  if (!takenFolded.has(foldName(desired))) return desired
  const { stem, ext } = isFile ? splitExtension(desired) : { stem: desired, ext: '' }
  for (let n = 2; n < 10000; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!takenFolded.has(foldName(candidate))) return candidate
  }
  throw new Error('Could not find a free name')
}

export function joinRel(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name
}

export function parentOf(relPath: string): string {
  const slash = relPath.lastIndexOf('/')
  return slash === -1 ? '' : relPath.slice(0, slash)
}

export function baseName(relPath: string): string {
  const slash = relPath.lastIndexOf('/')
  return slash === -1 ? relPath : relPath.slice(slash + 1)
}

/** True when `candidate` is `ancestor` itself or lies inside it. Paths are workspace-relative. */
export function isSameOrInside(candidate: string, ancestor: string): boolean {
  const c = foldName(candidate)
  const a = foldName(ancestor)
  return a === '' || c === a || c.startsWith(a + '/')
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'])

export function kindFromFileName(name: string): Exclude<EntryKind, 'folder' | 'latex_project'> {
  const ext = splitExtension(name).ext.toLowerCase()
  if (ext === '.docx') return 'docx'
  if (ext === '.md' || ext === '.markdown') return 'markdown'
  if (ext === '.pptx') return 'slides'
  if (ext === '.pdf') return 'pdf'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  return 'other'
}

/** The display title of an entry: the file name without its document extension. */
export function displayTitle(name: string, kind: EntryKind): string {
  return kind === 'docx' || kind === 'markdown' || kind === 'slides' ? splitExtension(name).stem : name
}

/** Kinds that open in a tab inside the app. Everything else is shown in its folder instead. */
export const OPENABLE_KINDS: readonly EntryKind[] = ['docx', 'markdown', 'latex_project', 'slides', 'pdf']

export function isOpenable(kind: string): boolean {
  return (OPENABLE_KINDS as readonly string[]).includes(kind)
}
