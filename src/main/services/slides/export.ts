import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import { PX_PER_INCH, type Presentation, type SlideShapeKind } from '@shared/domain/slides'
import { hashOf } from '../../infrastructure/fs/safe-write'

export const SLIDES_SIDECAR_PATH = 'offlineworkspace/presentation.json'

const inches = (px: number): number => px / PX_PER_INCH
const points = (px: number): number => (px * 72) / PX_PER_INCH
const hex = (color: string): string => color.replace('#', '').toUpperCase()
const transparency = (opacity: number): number => Math.round((1 - Math.min(1, Math.max(0, opacity))) * 100)

/** This app's shape kinds as PowerPoint preset geometry names. */
export const PRESET_GEOMETRY: Record<SlideShapeKind, string> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  triangle: 'triangle',
  diamond: 'diamond',
  pentagon: 'pentagon',
  hexagon: 'hexagon',
  star: 'star5',
  arrow: 'rightArrow',
  line: 'line'
}

/** The slide parts of a package in slide order, joined: what the sidecar hash is taken over. */
export async function slideXmlFingerprint(zip: JSZip): Promise<string> {
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
  let joined = ''
  for (const name of names) joined += `${name}\n${await zip.file(name)!.async('string')}\n`
  return hashOf(joined)
}

/**
 * Builds the `.pptx` bytes for a presentation: a real PowerPoint file with one slide per slide
 * and ordinary text boxes, pictures, and preset shapes. As with documents, the editor model is
 * also stored in the package (`offlineworkspace/presentation.json`) with a hash of the generated
 * slide parts. When this app reopens the file and the hash still matches it restores the exact
 * model; if another program rewrote the slides, the file is imported from its real content.
 */
export async function buildPptxBuffer(presentation: Presentation): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.author = 'Avalanche'
  pptx.company = ''
  pptx.defineLayout({ name: 'AVALANCHE', width: inches(presentation.width), height: inches(presentation.height) })
  pptx.layout = 'AVALANCHE'

  for (const slide of presentation.slides) {
    const target = pptx.addSlide()
    target.background = { color: hex(slide.background) }
    for (const element of slide.elements) {
      const box = { x: inches(element.x), y: inches(element.y), w: inches(element.w), h: inches(element.h) }
      const rotate = element.rotation ? { rotate: element.rotation } : {}
      if (element.type === 'text') {
        // An empty text box is an editing placeholder; it is kept in the model, not drawn.
        if (!element.text.trim()) continue
        const lines = element.text.split('\n')
        const content =
          element.list === 'none'
            ? element.text
            : lines.map((line, index) => ({
                text: line,
                options: { bullet: element.list === 'number' ? { type: 'number' as const } : true, breakLine: index < lines.length - 1 }
              }))
        target.addText(content, {
          ...box,
          ...rotate,
          fontFace: element.fontFamily,
          fontSize: element.fontSize,
          bold: element.bold,
          italic: element.italic,
          ...(element.underline ? { underline: { style: 'sng' as const } } : {}),
          color: hex(element.color),
          transparency: transparency(element.opacity),
          align: element.align,
          valign: element.valign,
          margin: 0,
          fit: 'none'
        })
      } else if (element.type === 'image') {
        target.addImage({ ...box, ...rotate, data: element.src.replace(/^data:/, ''), transparency: transparency(element.opacity) })
      } else if (element.shape === 'line') {
        // A line is drawn through the middle of its box.
        target.addShape('line' as PptxGenJS.ShapeType, {
          x: box.x,
          y: box.y + box.h / 2,
          w: box.w,
          h: 0,
          ...rotate,
          line: { color: hex(element.stroke), width: Math.max(0.25, points(element.strokeWidth)), transparency: transparency(element.opacity) }
        })
      } else {
        target.addShape(PRESET_GEOMETRY[element.shape] as PptxGenJS.ShapeType, {
          ...box,
          ...rotate,
          fill: { color: hex(element.fill), transparency: transparency(element.opacity) },
          ...(element.strokeWidth > 0 ? { line: { color: hex(element.stroke), width: points(element.strokeWidth), transparency: transparency(element.opacity) } } : {})
        })
      }
    }
    if (presentation.slideNumbers) {
      target.slideNumber = {
        x: inches(presentation.width - 90),
        y: inches(presentation.height - 34),
        w: inches(70),
        h: inches(22),
        align: 'right',
        fontFace: presentation.theme.bodyFont,
        fontSize: 10,
        color: hex(presentation.theme.muted)
      }
    }
    if (slide.notes.trim()) target.addNotes(slide.notes)
  }

  const generated = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
  const zip = await JSZip.loadAsync(generated)
  zip.file(SLIDES_SIDECAR_PATH, JSON.stringify({ version: 2, slidesSha1: await slideXmlFingerprint(zip), presentation }))
  const contentTypes = await zip.file('[Content_Types].xml')!.async('string')
  if (!/Extension="json"/i.test(contentTypes)) {
    zip.file('[Content_Types].xml', contentTypes.replace(/(<Types[^>]*>)/, '$1<Default Extension="json" ContentType="application/json"/>'))
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
