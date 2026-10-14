import path from 'node:path'
import JSZip from 'jszip'
import { PresentationSchema } from '@shared/contracts'
import { AppError } from '@shared/errors'
import {
  DEFAULT_TEXT_COLOR,
  DEFAULT_THEME,
  EMU_PER_PX,
  imageElement,
  MAX_SLIDES,
  normalizeColor,
  normalizeFont,
  normalizeRotation,
  presentationText,
  shapeElement,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  textBox,
  type Presentation,
  type Slide,
  type SlideAlign,
  type SlideElement,
  type SlideFont,
  type SlideList,
  type SlideShapeKind,
  type SlideVAlign
} from '@shared/domain/slides'
import { uuidv7 } from '@shared/domain/uuid'
import { child, childrenNamed, descendants, parseXml, path as xmlPath, type XmlNode } from '@shared/domain/xml'
import { PRESET_GEOMETRY, SLIDES_SIDECAR_PATH, slideXmlFingerprint } from './export'

export interface ImportedPptx {
  presentation: Presentation
  warnings: string[]
  /** True when the file was last written by this app and its editor model was restored exactly. */
  native: boolean
}

const MAX_PPTX_BYTES = 200 * 1024 * 1024
const MAX_PART_CHARS = 20_000_000
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_ELEMENTS_PER_SLIDE = 300
const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' }
const INVALID = 'This file is not a valid .pptx presentation.'

interface Box {
  x: number
  y: number
  w: number
  h: number
}
type Transform = (box: Box) => Box
interface Placeholder {
  type: string
  idx: string | undefined
  box: Box
}

const px = (emu: string | undefined): number => Math.round((Number(emu) || 0) / EMU_PER_PX)
const SHAPE_BY_PRESET = new Map(Object.entries(PRESET_GEOMETRY).map(([kind, preset]) => [preset, kind as SlideShapeKind]))
/** Rotation is stored in 60,000ths of a degree. */
const rotationOf = (xfrm: XmlNode | undefined): number => normalizeRotation((Number(xfrm?.attrs.rot) || 0) / 60000)

async function readPart(zip: JSZip, name: string): Promise<XmlNode | null> {
  const text = await zip.file(name)?.async('string')
  if (text === undefined) return null
  if (text.length > MAX_PART_CHARS) throw new AppError('INVALID_INPUT', 'This presentation is too large to open.')
  return parseXml(text)
}

/** Relationship id → package path of the target, for the relationships of one part. */
async function relationships(zip: JSZip, partName: string): Promise<Map<string, { target: string; type: string }>> {
  const dir = path.posix.dirname(partName)
  const rels = await readPart(zip, `${dir}/_rels/${path.posix.basename(partName)}.rels`)
  const out = new Map<string, { target: string; type: string }>()
  for (const rel of descendants(rels ?? undefined, 'Relationship')) {
    if (rel.attrs.TargetMode === 'External' || !rel.attrs.Id || !rel.attrs.Target) continue
    const raw = rel.attrs.Target
    const target = raw.startsWith('/') ? path.posix.normalize(raw.slice(1)) : path.posix.normalize(path.posix.join(dir, raw))
    if (!target.startsWith('..')) out.set(rel.attrs.Id, { target, type: rel.attrs.Type ?? '' })
  }
  return out
}

function xfrmBox(xfrm: XmlNode | undefined): Box | null {
  const off = child(xfrm, 'a:off')
  const ext = child(xfrm, 'a:ext')
  if (!off || !ext) return null
  return { x: px(off.attrs.x), y: px(off.attrs.y), w: px(ext.attrs.cx), h: px(ext.attrs.cy) }
}

const placeholderOf = (shape: XmlNode): XmlNode | undefined => xmlPath(shape, 'p:nvSpPr', 'p:nvPr', 'p:ph')

function placeholders(part: XmlNode | null): Placeholder[] {
  const out: Placeholder[] = []
  for (const shape of descendants(part ?? undefined, 'p:sp')) {
    const ph = placeholderOf(shape)
    const box = xfrmBox(xmlPath(shape, 'p:spPr', 'a:xfrm'))
    if (ph && box) out.push({ type: ph.attrs.type ?? 'body', idx: ph.attrs.idx, box })
  }
  return out
}

const isTitle = (type: string): boolean => type === 'title' || type === 'ctrTitle'

/** Where a placeholder without its own position sits: the layout's, the master's, then a default. */
function inheritedBox(ph: XmlNode, layout: Placeholder[], master: Placeholder[], width: number, height: number): Box {
  const type = ph.attrs.type ?? 'body'
  const idx = ph.attrs.idx
  const sameKind = (candidate: Placeholder): boolean => candidate.type === type || (isTitle(candidate.type) && isTitle(type))
  const found =
    (idx !== undefined ? layout.find((candidate) => candidate.idx === idx) : undefined) ??
    layout.find(sameKind) ??
    master.find(sameKind) ??
    (type === 'subTitle' ? master.find((candidate) => candidate.type === 'body') : undefined)
  if (found) return found.box
  const margin = Math.round(width * 0.0625)
  return isTitle(type)
    ? { x: margin, y: Math.round(height * 0.08), w: width - margin * 2, h: Math.round(height * 0.17) }
    : { x: margin, y: Math.round(height * 0.29), w: width - margin * 2, h: Math.round(height * 0.6) }
}

function solidColor(node: XmlNode | undefined): string | null {
  const value = xmlPath(node, 'a:solidFill', 'a:srgbClr')?.attrs.val
  return value ? normalizeColor(value, '') || null : null
}

/** Opacity of a solid fill, from its alpha (100000 is opaque). */
function solidOpacity(node: XmlNode | undefined): number {
  const alpha = Number(xmlPath(node, 'a:solidFill', 'a:srgbClr', 'a:alpha')?.attrs.val)
  return Number.isFinite(alpha) && alpha >= 0 && alpha <= 100000 ? Math.round(alpha / 1000) / 100 : 1
}

interface TextContent {
  text: string
  fontSize: number | null
  bold: boolean
  italic: boolean
  color: string | null
  align: SlideAlign | null
  fontFamily: SlideFont | null
  underline: boolean
  list: SlideList
  valign: SlideVAlign | null
}

function readText(body: XmlNode | undefined, bulleted: boolean): TextContent {
  const paragraphs = childrenNamed(body, 'a:p')
  const lines: string[] = []
  let first: XmlNode | undefined
  let align: SlideAlign | null = null
  let list: SlideList | null = null
  for (const paragraph of paragraphs) {
    let line = ''
    for (const part of paragraph.children) {
      if (part.name === 'a:r' || part.name === 'a:fld') {
        first ??= child(part, 'a:rPr')
        line += child(part, 'a:t')?.text ?? ''
      } else if (part.name === 'a:br') {
        line += '\n'
      }
    }
    const properties = child(paragraph, 'a:pPr')
    if (align === null && properties?.attrs.algn) align = properties.attrs.algn === 'ctr' ? 'center' : properties.attrs.algn === 'r' ? 'right' : 'left'
    if (line.trim() !== '' && list === null) {
      if (child(properties, 'a:buAutoNum')) list = 'number'
      else if (child(properties, 'a:buChar')) list = 'bullet'
      else if (child(properties, 'a:buNone')) list = 'none'
    }
    lines.push(line)
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  // A body placeholder is a bulleted list unless its paragraphs say otherwise.
  if (list === null) list = bulleted && lines.filter((line) => line.trim() !== '').length > 1 ? 'bullet' : 'none'
  const anchor = child(body, 'a:bodyPr')?.attrs.anchor
  const typeface = child(first, 'a:latin')?.attrs.typeface
  const size = Number(first?.attrs.sz)
  return {
    text: lines.join('\n'),
    fontSize: Number.isFinite(size) && size > 0 ? Math.min(400, Math.max(6, Math.round(size / 100))) : null,
    bold: first?.attrs.b === '1' || first?.attrs.b === 'true',
    italic: first?.attrs.i === '1' || first?.attrs.i === 'true',
    color: solidColor(first),
    align,
    fontFamily: typeface ? normalizeFont(typeface) : null,
    underline: first?.attrs.u !== undefined && first.attrs.u !== 'none',
    list,
    valign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : anchor === 't' ? 'top' : null
  }
}

interface SlideContext {
  zip: JSZip
  rels: Map<string, { target: string; type: string }>
  layout: Placeholder[]
  master: Placeholder[]
  width: number
  height: number
  warnings: Set<string>
  elements: SlideElement[]
}

async function readTree(tree: XmlNode | undefined, transform: Transform, context: SlideContext): Promise<void> {
  for (const node of tree?.children ?? []) {
    if (context.elements.length >= MAX_ELEMENTS_PER_SLIDE) return
    if (node.name === 'p:sp') {
      const ph = placeholderOf(node)
      const properties = child(node, 'p:spPr')
      const own = xfrmBox(child(properties, 'a:xfrm'))
      if (!own && !ph) continue
      const box = transform(own ?? inheritedBox(ph!, context.layout, context.master, context.width, context.height))
      const type = ph?.attrs.type ?? (ph ? 'body' : '')
      // Slide numbers, dates, and footers are furniture of the template, not content.
      if (type === 'sldNum' || type === 'dt' || type === 'ftr' || type === 'hdr') continue
      const rotation = rotationOf(child(properties, 'a:xfrm'))
      const fill = ph ? null : solidColor(properties)
      const outline = child(properties, 'a:ln')
      const stroke = ph ? null : solidColor(outline)
      const preset = child(properties, 'a:prstGeom')?.attrs.prst ?? 'rect'
      const kind = SHAPE_BY_PRESET.get(preset)
      if (fill || stroke) {
        if (!kind) context.warnings.add('Shapes this app does not have were drawn as rectangles.')
        const strokeWidth = stroke ? Math.max(1, Math.min(100, px(outline?.attrs.w) || 1)) : 0
        if (kind === 'line') {
          // A line is kept as a box with the line through its middle.
          const thickness = Math.max(16, strokeWidth)
          context.elements.push(
            shapeElement('line', { x: box.x, y: box.y + box.h / 2 - thickness / 2, w: box.w, h: thickness, stroke: stroke ?? fill ?? DEFAULT_TEXT_COLOR, strokeWidth: Math.max(1, strokeWidth), rotation })
          )
        } else {
          context.elements.push(
            shapeElement(kind ?? 'rect', { ...box, fill: fill ?? '#ffffff', stroke: stroke ?? fill ?? DEFAULT_TEXT_COLOR, strokeWidth, rotation, opacity: fill ? solidOpacity(properties) : 1 })
          )
        }
      }
      const content = readText(child(node, 'p:txBody'), type === 'body' || type === 'obj')
      if (content.text.trim()) {
        context.elements.push(
          textBox({
            ...box,
            rotation,
            text: content.text,
            fontFamily: content.fontFamily ?? 'Calibri',
            fontSize: content.fontSize ?? (type === 'ctrTitle' ? 40 : isTitle(type) ? 32 : type === 'subTitle' ? 20 : 18),
            bold: content.bold || isTitle(type),
            italic: content.italic,
            underline: content.underline,
            color: content.color ?? DEFAULT_TEXT_COLOR,
            align: content.align ?? (type === 'ctrTitle' || type === 'subTitle' ? 'center' : 'left'),
            valign: content.valign ?? 'top',
            list: content.list
          })
        )
      }
    } else if (node.name === 'p:pic') {
      const pictureXfrm = xmlPath(node, 'p:spPr', 'a:xfrm')
      const box = xfrmBox(pictureXfrm)
      const embed = xmlPath(node, 'p:blipFill', 'a:blip')?.attrs['r:embed']
      const target = embed ? context.rels.get(embed)?.target : undefined
      const mime = target ? IMAGE_MIME[path.posix.extname(target).toLowerCase()] : undefined
      const file = target ? context.zip.file(target) : null
      if (!box || !file || !mime) {
        context.warnings.add('Pictures in formats other than PNG, JPEG, and GIF were left out.')
        continue
      }
      const data = await file.async('nodebuffer')
      if (data.length > MAX_IMAGE_BYTES) {
        context.warnings.add('Pictures larger than 10 MB were left out.')
        continue
      }
      context.elements.push({ ...imageElement(`data:${mime};base64,${data.toString('base64')}`, transform(box)), rotation: rotationOf(pictureXfrm) })
    } else if (node.name === 'p:grpSp') {
      // A group has its own coordinate space; its children are mapped back onto the slide.
      const xfrm = xmlPath(node, 'p:grpSpPr', 'a:xfrm')
      const outer = xfrmBox(xfrm)
      const childOff = child(xfrm, 'a:chOff')
      const childExt = child(xfrm, 'a:chExt')
      const inner = childOff && childExt ? { x: px(childOff.attrs.x), y: px(childOff.attrs.y), w: px(childExt.attrs.cx), h: px(childExt.attrs.cy) } : null
      const nested: Transform =
        outer && inner && inner.w > 0 && inner.h > 0
          ? (box) =>
              transform({
                x: outer.x + ((box.x - inner.x) * outer.w) / inner.w,
                y: outer.y + ((box.y - inner.y) * outer.h) / inner.h,
                w: (box.w * outer.w) / inner.w,
                h: (box.h * outer.h) / inner.h
              })
          : transform
      await readTree(node, nested, context)
    } else if (node.name === 'p:graphicFrame') {
      context.warnings.add('Tables, charts, and diagrams were left out.')
    } else if (node.name === 'p:cxnSp') {
      // A connector runs corner to corner in its box; it becomes a line of the same length and angle.
      const properties = child(node, 'p:spPr')
      const xfrm = child(properties, 'a:xfrm')
      const raw = xfrmBox(xfrm)
      if (!raw) continue
      const box = transform(raw)
      const outline = child(properties, 'a:ln')
      const strokeWidth = Math.max(1, Math.min(100, px(outline?.attrs.w) || 1))
      const length = Math.max(1, Math.hypot(box.w, box.h))
      const flipped = (xfrm?.attrs.flipV === '1') !== (xfrm?.attrs.flipH === '1')
      const angle = (Math.atan2(box.h, box.w) * 180) / Math.PI
      const thickness = Math.max(16, strokeWidth)
      context.elements.push(
        shapeElement('line', {
          x: box.x + box.w / 2 - length / 2,
          y: box.y + box.h / 2 - thickness / 2,
          w: length,
          h: thickness,
          stroke: solidColor(outline) ?? DEFAULT_TEXT_COLOR,
          strokeWidth,
          rotation: normalizeRotation((flipped ? -angle : angle) + rotationOf(xfrm))
        })
      )
    }
  }
}

async function readNotes(zip: JSZip, rels: Map<string, { target: string; type: string }>): Promise<string> {
  const target = [...rels.values()].find((rel) => rel.type.endsWith('/notesSlide'))?.target
  const notes = target ? await readPart(zip, target) : null
  for (const shape of descendants(notes ?? undefined, 'p:sp')) {
    if (placeholderOf(shape)?.attrs.type === 'body') return readText(child(shape, 'p:txBody'), false).text.slice(0, 20_000)
  }
  return ''
}

async function importForeign(zip: JSZip): Promise<{ presentation: Presentation; warnings: string[] }> {
  const main = await readPart(zip, 'ppt/presentation.xml')
  if (!main) throw new AppError('INVALID_INPUT', INVALID)
  const size = descendants(main, 'p:sldSz')[0]
  const width = Math.min(5000, Math.max(100, px(size?.attrs.cx) || SLIDE_WIDTH))
  const height = Math.min(5000, Math.max(100, px(size?.attrs.cy) || SLIDE_HEIGHT))
  const mainRels = await relationships(zip, 'ppt/presentation.xml')
  const warnings = new Set<string>(['Themes, slide layouts, animations, and transitions are not imported; text and pictures are placed as plain boxes.'])
  const slides: Slide[] = []

  for (const reference of descendants(main, 'p:sldId')) {
    if (slides.length >= MAX_SLIDES) {
      warnings.add(`Only the first ${MAX_SLIDES} slides were imported.`)
      break
    }
    const slidePath = mainRels.get(reference.attrs['r:id'] ?? '')?.target
    const part = slidePath ? await readPart(zip, slidePath) : null
    if (!slidePath || !part) continue
    const rels = await relationships(zip, slidePath)
    const layoutPath = [...rels.values()].find((rel) => rel.type.endsWith('/slideLayout'))?.target
    const layoutPart = layoutPath ? await readPart(zip, layoutPath) : null
    const masterPath = layoutPath ? [...(await relationships(zip, layoutPath)).values()].find((rel) => rel.type.endsWith('/slideMaster'))?.target : undefined
    const context: SlideContext = {
      zip,
      rels,
      layout: placeholders(layoutPart),
      master: placeholders(masterPath ? await readPart(zip, masterPath) : null),
      width,
      height,
      warnings,
      elements: []
    }
    const content = xmlPath(child(part, 'p:sld'), 'p:cSld')
    await readTree(child(content, 'p:spTree'), (box) => box, context)
    slides.push({
      id: uuidv7(),
      background: solidColor(xmlPath(content, 'p:bg', 'p:bgPr')) ?? '#ffffff',
      elements: context.elements.map((element) => ({
        ...element,
        x: Math.round(element.x),
        y: Math.round(element.y),
        w: Math.max(1, Math.round(element.w)),
        h: Math.max(1, Math.round(element.h))
      })),
      notes: await readNotes(zip, rels)
    })
  }
  if (slides.length === 0) slides.push({ id: uuidv7(), background: '#ffffff', elements: [], notes: '' })
  return { presentation: { width, height, theme: DEFAULT_THEME, slideNumbers: false, slides }, warnings: [...warnings] }
}

/**
 * Reads a `.pptx` locally. Files last written by this app restore their stored model. Files
 * written by another program are read from their PresentationML: slide size, text boxes,
 * pictures, filled rectangles and ellipses, solid backgrounds, and speaker notes. Nothing in
 * the file is executed and nothing is sent anywhere.
 */
export async function readPptxBuffer(buffer: Buffer): Promise<ImportedPptx> {
  if (buffer.length > MAX_PPTX_BYTES) throw new AppError('INVALID_INPUT', 'This presentation is too large to open.')
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new AppError('INVALID_INPUT', INVALID)
  }
  if (!zip.file('ppt/presentation.xml')) throw new AppError('INVALID_INPUT', INVALID)
  if (zip.file('ppt/vbaProject.bin')) throw new AppError('INVALID_INPUT', 'Presentations with macros are not supported.')

  const sidecar = await zip.file(SLIDES_SIDECAR_PATH)?.async('string')
  if (sidecar) {
    try {
      const parsed = JSON.parse(sidecar) as { slidesSha1?: string; presentation?: unknown }
      // The stored model is checked like any other input before it is trusted.
      const model = PresentationSchema.safeParse(parsed.presentation)
      if (model.success && parsed.slidesSha1 === (await slideXmlFingerprint(zip))) {
        return { presentation: model.data, warnings: [], native: true }
      }
    } catch {
      // A damaged sidecar is ignored; the real slides are imported below.
    }
  }
  return { ...(await importForeign(zip)), native: false }
}

export async function extractPptxText(buffer: Buffer): Promise<string> {
  try {
    return presentationText((await readPptxBuffer(buffer)).presentation)
  } catch {
    return ''
  }
}
