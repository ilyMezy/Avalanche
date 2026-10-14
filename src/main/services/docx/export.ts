import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild
} from 'docx'
import JSZip from 'jszip'
import type { TiptapMark, TiptapNode } from '@shared/types'
import { hashOf } from '../../infrastructure/fs/safe-write'

// Converts the editor model (Tiptap/ProseMirror JSON) into real WordprocessingML using the
// open-source `docx` writer, entirely locally. The supported profile is: headings 1–4,
// paragraphs, bold/italic/underline/strikethrough/code, alignment, bulleted and numbered
// lists (nested), links, tables, inline images, block quotes, code blocks, horizontal rules.

export const SIDECAR_PATH = 'offlineworkspace/document.json'
const NUMBERING_REF = 'ow-numbered'
const MAX_IMAGE_WIDTH = 600

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4]
const ALIGNMENTS: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED
}

type Block = Paragraph | Table
interface ListContext {
  ordered: boolean
  level: number
  instance: number
}
interface BuildState {
  nextNumberingInstance: number
}

function runFormat(marks: TiptapMark[] | undefined): Partial<IRunOptions> & { href?: string } {
  const format: { -readonly [K in keyof IRunOptions]?: IRunOptions[K] } & { href?: string } = {}
  for (const mark of marks ?? []) {
    if (mark.type === 'bold') format.bold = true
    else if (mark.type === 'italic') format.italics = true
    else if (mark.type === 'underline') format.underline = {}
    else if (mark.type === 'strike') format.strike = true
    else if (mark.type === 'textStyle') {
      // Explicit font choices made in the editor are stored in the document.
      const family = typeof mark.attrs?.fontFamily === 'string' ? mark.attrs.fontFamily.split(',')[0].replace(/['"]/g, '').trim() : ''
      if (family) format.font = family
      const size = typeof mark.attrs?.fontSize === 'string' ? /^([\d.]+)\s*(pt|px)$/.exec(mark.attrs.fontSize.trim()) : null
      if (size) {
        const points = size[2] === 'px' ? Number(size[1]) * 0.75 : Number(size[1])
        // WordprocessingML measures font size in half-points.
        if (points >= 1 && points <= 400) format.size = Math.round(points * 2)
      }
    } else if (mark.type === 'code') format.font = 'Consolas'
    else if (mark.type === 'link' && typeof mark.attrs?.href === 'string') format.href = mark.attrs.href
  }
  return format
}

export function imageSize(data: Buffer): { width: number; height: number } | null {
  // PNG: width and height are big-endian integers in the IHDR chunk.
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  }
  // JPEG: scan the segments for a start-of-frame marker.
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) return null
      const marker = data[offset + 1]
      const length = data.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) }
      }
      offset += 2 + length
    }
  }
  // GIF: little-endian logical screen size.
  if (data.length > 10 && data.toString('ascii', 0, 3) === 'GIF') {
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) }
  }
  return null
}

function imageRun(node: TiptapNode): ImageRun | TextRun {
  const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
  const match = /^data:image\/(png|jpeg|jpg|gif|bmp);base64,(.+)$/s.exec(src)
  if (!match) return new TextRun({ text: '[image not embedded]', italics: true })
  const data = Buffer.from(match[2], 'base64')
  const type = match[1] === 'jpeg' ? 'jpg' : (match[1] as 'png' | 'jpg' | 'gif' | 'bmp')
  const natural = imageSize(data) ?? { width: 400, height: 300 }
  let width = Number(node.attrs?.width) || natural.width
  let height = Number(node.attrs?.height) || Math.round((width / natural.width) * natural.height)
  if (width > MAX_IMAGE_WIDTH) {
    height = Math.round((MAX_IMAGE_WIDTH / width) * height)
    width = MAX_IMAGE_WIDTH
  }
  return new ImageRun({ type, data, transformation: { width, height } })
}

function inlines(nodes: TiptapNode[] | undefined, base: Partial<IRunOptions> = {}): ParagraphChild[] {
  const out: ParagraphChild[] = []
  for (const node of nodes ?? []) {
    if (node.type === 'text') {
      const { href, ...format } = runFormat(node.marks)
      if (href) {
        out.push(
          new ExternalHyperlink({
            link: href,
            children: [new TextRun({ ...base, ...format, text: node.text ?? '', style: 'Hyperlink' })]
          })
        )
      } else {
        out.push(new TextRun({ ...base, ...format, text: node.text ?? '' }))
      }
    } else if (node.type === 'hardBreak') {
      out.push(new TextRun({ break: 1 }))
    } else if (node.type === 'image') {
      out.push(imageRun(node))
    }
  }
  return out
}

function paragraphOptions(node: TiptapNode, list?: ListContext, indentLeft?: number): Partial<IParagraphOptions> {
  const align = typeof node.attrs?.textAlign === 'string' ? ALIGNMENTS[node.attrs.textAlign] : undefined
  return {
    ...(align ? { alignment: align } : {}),
    ...(list
      ? list.ordered
        ? { numbering: { reference: NUMBERING_REF, level: Math.min(list.level, 8), instance: list.instance } }
        : { bullet: { level: Math.min(list.level, 8) } }
      : {}),
    ...(indentLeft ? { indent: { left: indentLeft } } : {})
  }
}

function listBlocks(node: TiptapNode, level: number, state: BuildState): Block[] {
  const ordered = node.type === 'orderedList'
  const context: ListContext = { ordered, level, instance: ordered ? state.nextNumberingInstance++ : 0 }
  const out: Block[] = []
  for (const item of node.content ?? []) {
    let first = true
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        out.push(...listBlocks(child, level + 1, state))
      } else if (child.type === 'paragraph') {
        out.push(
          new Paragraph({
            ...paragraphOptions(child, first ? context : undefined, first ? undefined : 720 * (level + 1)),
            children: inlines(child.content)
          })
        )
        first = false
      } else {
        out.push(...blocks([child], state, 720 * (level + 1)))
      }
    }
  }
  return out
}

function tableBlock(node: TiptapNode, state: BuildState): Table {
  const rows = (node.content ?? []).map(
    (row) =>
      new TableRow({
        children: (row.content ?? []).map((cell) => {
          const header = cell.type === 'tableHeader'
          const children = blocks(cell.content ?? [], state, undefined, header ? { bold: true } : {})
          return new TableCell({
            children: children.length > 0 ? children : [new Paragraph({})],
            columnSpan: Number(cell.attrs?.colspan) > 1 ? Number(cell.attrs?.colspan) : undefined,
            rowSpan: Number(cell.attrs?.rowspan) > 1 ? Number(cell.attrs?.rowspan) : undefined,
            shading: header ? { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' } : undefined
          })
        })
      })
  )
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })
}

function blocks(nodes: TiptapNode[], state: BuildState, indentLeft?: number, base: Partial<IRunOptions> = {}): Block[] {
  const out: Block[] = []
  // A page break in the editor model becomes a real WordprocessingML page break. When the
  // next block is a paragraph, heading, or image it is marked "page break before", which adds
  // no empty line; before a table, list, or other block an explicit break paragraph is used.
  let breakPending = false
  const breakParagraph = (): Paragraph => new Paragraph({ spacing: { after: 0 }, children: [new PageBreak()] })
  for (const node of nodes) {
    if (node.type === 'pageBreak') {
      if (breakPending) out.push(breakParagraph())
      breakPending = true
      continue
    }
    const acceptsBreak = node.type === 'paragraph' || node.type === 'heading' || node.type === 'image'
    if (breakPending && !acceptsBreak) out.push(breakParagraph())
    const before = breakPending && acceptsBreak ? { pageBreakBefore: true } : {}
    breakPending = false
    switch (node.type) {
      case 'paragraph':
        out.push(new Paragraph({ ...paragraphOptions(node, undefined, indentLeft), ...before, children: inlines(node.content, base) }))
        break
      case 'heading': {
        const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 4)
        out.push(
          new Paragraph({
            ...paragraphOptions(node, undefined, indentLeft),
            ...before,
            heading: HEADINGS[level - 1],
            children: inlines(node.content, base)
          })
        )
        break
      }
      case 'bulletList':
      case 'orderedList':
        out.push(...listBlocks(node, 0, state))
        break
      case 'blockquote':
        out.push(...blocks(node.content ?? [], state, (indentLeft ?? 0) + 720, { ...base, italics: true }))
        break
      case 'codeBlock': {
        const text = (node.content ?? []).map((n) => n.text ?? '').join('')
        for (const line of text.split('\n')) {
          out.push(
            new Paragraph({
              indent: indentLeft ? { left: indentLeft } : undefined,
              spacing: { after: 0 },
              children: [new TextRun({ text: line, font: 'Consolas', size: 20 })]
            })
          )
        }
        break
      }
      case 'horizontalRule':
        out.push(
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'A0A0A0', space: 1 } },
            children: []
          })
        )
        break
      case 'image':
        out.push(new Paragraph({ ...before, children: [imageRun(node)] }))
        break
      case 'table':
        out.push(tableBlock(node, state))
        // Word requires a paragraph after a table that ends a cell or the document.
        out.push(new Paragraph({}))
        break
      default:
        if (node.content) out.push(...blocks(node.content, state, indentLeft, base))
    }
  }
  if (breakPending) out.push(breakParagraph())
  return out
}

export function emptyDocument(): TiptapNode {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

/**
 * Builds the `.docx` bytes for a document. The editor model is also stored inside the package
 * as an extra part (`offlineworkspace/document.json`) together with a hash of the generated
 * `word/document.xml`. When this app reopens the file and the hash still matches, it restores
 * the exact editor state; if another program rewrote the file, the hash no longer matches (or
 * the part is gone) and the file is imported from its real WordprocessingML instead.
 */
export async function buildDocxBuffer(doc: TiptapNode): Promise<Buffer> {
  const state: BuildState = { nextNumberingInstance: 1 }
  const children = blocks(doc.content ?? [], state)
  const document = new Document({
    creator: 'Avalanche',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { after: 160, line: 276 } } } } },
    numbering: {
      config: [
        {
          reference: NUMBERING_REF,
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: level % 3 === 0 ? LevelFormat.DECIMAL : level % 3 === 1 ? LevelFormat.LOWER_LETTER : LevelFormat.LOWER_ROMAN,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } }
          }))
        }
      ]
    },
    sections: [{ children: children.length > 0 ? children : [new Paragraph({})] }]
  })

  const zip = await JSZip.loadAsync(await Packer.toBuffer(document))
  const documentXml = await zip.file('word/document.xml')!.async('string')
  zip.file(SIDECAR_PATH, JSON.stringify({ version: 1, documentXmlSha1: hashOf(documentXml), doc }))
  const contentTypes = await zip.file('[Content_Types].xml')!.async('string')
  if (!/Extension="json"/i.test(contentTypes)) {
    zip.file(
      '[Content_Types].xml',
      contentTypes.replace(/(<Types[^>]*>)/, '$1<Default Extension="json" ContentType="application/json"/>')
    )
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
