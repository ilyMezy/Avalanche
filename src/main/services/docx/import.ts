import JSZip from 'jszip'
import mammoth from 'mammoth'
import { AppError } from '@shared/errors'
import type { TiptapNode } from '@shared/types'
import { hashOf } from '../../infrastructure/fs/safe-write'
import { SIDECAR_PATH } from './export'

export interface ImportedDocx {
  doc: TiptapNode | null
  html: string | null
  warnings: string[]
  /** True when the file was last written by this app and its editor model was restored exactly. */
  native: boolean
}

const MAX_DOCX_BYTES = 100 * 1024 * 1024

/**
 * Reads a `.docx` locally. Files last written by this app restore their stored editor model.
 * Files written by other programs are converted from their WordprocessingML with the
 * open-source `mammoth` reader, which covers a subset (headings, emphasis, lists, links,
 * tables, images). Nothing is sent to any service.
 */
export async function readDocxBuffer(buffer: Buffer): Promise<ImportedDocx> {
  if (buffer.length > MAX_DOCX_BYTES) throw new AppError('INVALID_INPUT', 'This document is too large to open.')

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new AppError('INVALID_INPUT', 'This file is not a valid .docx document.')
  }
  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (documentXml === undefined) throw new AppError('INVALID_INPUT', 'This file is not a valid .docx document.')
  if (zip.file('word/vbaProject.bin')) throw new AppError('INVALID_INPUT', 'Documents with macros are not supported.')

  const sidecar = await zip.file(SIDECAR_PATH)?.async('string')
  if (sidecar) {
    try {
      const parsed = JSON.parse(sidecar) as { documentXmlSha1?: string; doc?: TiptapNode }
      if (parsed.doc && parsed.documentXmlSha1 === hashOf(documentXml)) {
        return { doc: parsed.doc, html: null, warnings: [], native: true }
      }
    } catch {
      // A damaged sidecar is ignored; the real document content is imported below.
    }
  }

  const result = await mammoth.convertToHtml({ buffer }, { styleMap: ['u => u', 'strike => s'] })
  const warnings = Array.from(new Set(result.messages.map((m) => m.message))).slice(0, 20)
  return { doc: null, html: result.value, warnings, native: false }
}

export async function extractDocxText(buffer: Buffer): Promise<string> {
  try {
    return (await mammoth.extractRawText({ buffer })).value
  } catch {
    return ''
  }
}
