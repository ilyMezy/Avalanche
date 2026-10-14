import { uuidv7 } from './uuid'

// The slide model the Slides editor works on. Positions and sizes are in slide pixels at
// 96 per inch, so the default 960 × 540 slide is PowerPoint's 10 × 5.625 inch widescreen page.
// Font sizes are in points, as they are in PowerPoint. Rotation is in degrees, clockwise,
// about the element's centre.

export const SLIDE_WIDTH = 960
export const SLIDE_HEIGHT = 540
export const PX_PER_INCH = 96
export const EMU_PER_PX = 9525
export const MAX_SLIDES = 500
/** The most PDF pages that "Convert to editable slides" turns into slides at once. */
export const MAX_PDF_SLIDES = 150
export const MIN_ELEMENT_SIZE = 16

/** Fonts that ship with Windows or Office, so a deck looks the same in PowerPoint. */
export const SLIDE_FONTS = [
  'Calibri',
  'Arial',
  'Segoe UI',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Century Gothic',
  'Georgia',
  'Cambria',
  'Garamond',
  'Times New Roman',
  'Courier New',
  'Consolas',
  'Impact',
  'Comic Sans MS'
] as const
export type SlideFont = (typeof SLIDE_FONTS)[number]

export const SHAPE_KINDS = ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'arrow', 'line'] as const
export type SlideShapeKind = (typeof SHAPE_KINDS)[number]
export const SHAPE_LABELS: Record<SlideShapeKind, string> = {
  rect: 'Rectangle',
  roundRect: 'Rounded rectangle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  diamond: 'Diamond',
  pentagon: 'Pentagon',
  hexagon: 'Hexagon',
  star: 'Star',
  arrow: 'Arrow',
  line: 'Line'
}

export type SlideAlign = 'left' | 'center' | 'right'
export type SlideVAlign = 'top' | 'middle' | 'bottom'
export type SlideList = 'none' | 'bullet' | 'number'

interface Box {
  id: string
  x: number
  y: number
  w: number
  h: number
  rotation: number
  /** 0 (invisible) to 1 (solid). */
  opacity: number
}
export interface SlideText extends Box {
  type: 'text'
  text: string
  fontFamily: SlideFont
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  /** `#rrggbb` */
  color: string
  align: SlideAlign
  valign: SlideVAlign
  /** Each line of the text is a list item when this is not 'none'. */
  list: SlideList
}
export interface SlideImage extends Box {
  type: 'image'
  /** A `data:image/png|jpeg|gif;base64,…` URL. */
  src: string
}
export interface SlideShape extends Box {
  type: 'shape'
  shape: SlideShapeKind
  fill: string
  /** Outline colour; for a line, the colour of the line itself. */
  stroke: string
  /** Outline width in slide pixels; 0 means no outline. */
  strokeWidth: number
}
export type SlideElement = SlideText | SlideImage | SlideShape

export interface Slide {
  id: string
  /** `#rrggbb` */
  background: string
  /** Drawn back to front. */
  elements: SlideElement[]
  notes: string
}

/** The colours and fonts a deck's layouts are built from. */
export interface SlideTheme {
  id: string
  background: string
  title: string
  text: string
  muted: string
  accent: string
  accent2: string
  headingFont: SlideFont
  bodyFont: SlideFont
  decor: 'none' | 'bar' | 'corner' | 'band'
}

export interface Presentation {
  width: number
  height: number
  theme: SlideTheme
  /** Show the slide number in the bottom-right corner of every slide. */
  slideNumbers: boolean
  slides: Slide[]
}

export const DEFAULT_TEXT_COLOR = '#1f2937'
export const DEFAULT_THEME: SlideTheme = {
  id: 'simple',
  background: '#ffffff',
  title: '#111827',
  text: DEFAULT_TEXT_COLOR,
  muted: '#6b7280',
  accent: '#2563eb',
  accent2: '#93c5fd',
  headingFont: 'Calibri',
  bodyFont: 'Calibri',
  decor: 'none'
}

// ---- Templates --------------------------------------------------------------------------

export const SLIDE_TEMPLATES: { id: string; name: string; description: string; theme: SlideTheme }[] = [
  { id: 'simple', name: 'Simple', description: 'White, clean, no decoration', theme: DEFAULT_THEME },
  {
    id: 'summit',
    name: 'Summit',
    description: 'Blue accent bar, crisp headings',
    theme: { id: 'summit', background: '#ffffff', title: '#0f2a4a', text: '#27364a', muted: '#64748b', accent: '#1d6fd1', accent2: '#8cc4f5', headingFont: 'Segoe UI', bodyFont: 'Segoe UI', decor: 'bar' }
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Dark navy with bright accents',
    theme: { id: 'midnight', background: '#0b1220', title: '#f8fafc', text: '#d5deea', muted: '#8a99ad', accent: '#38bdf8', accent2: '#6366f1', headingFont: 'Century Gothic', bodyFont: 'Calibri', decor: 'corner' }
  },
  {
    id: 'alpenglow',
    name: 'Alpenglow',
    description: 'Warm sunrise colours',
    theme: { id: 'alpenglow', background: '#fff8f1', title: '#7c2d12', text: '#4a3328', muted: '#9a7b6a', accent: '#ea580c', accent2: '#fbbf77', headingFont: 'Georgia', bodyFont: 'Verdana', decor: 'band' }
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Calm greens, serif headings',
    theme: { id: 'forest', background: '#f4f8f4', title: '#14432a', text: '#2c4033', muted: '#6c8274', accent: '#2f8f5b', accent2: '#b7dcc4', headingFont: 'Cambria', bodyFont: 'Calibri', decor: 'bar' }
  },
  {
    id: 'mono',
    name: 'Mono',
    description: 'Black and white, bold type',
    theme: { id: 'mono', background: '#ffffff', title: '#000000', text: '#262626', muted: '#737373', accent: '#000000', accent2: '#d4d4d4', headingFont: 'Impact', bodyFont: 'Arial', decor: 'band' }
  },
  {
    id: 'chalk',
    name: 'Chalkboard',
    description: 'Dark green board for lessons',
    theme: { id: 'chalk', background: '#17332a', title: '#fdf6d8', text: '#e6efe9', muted: '#9db5a8', accent: '#f6c945', accent2: '#7fd1ae', headingFont: 'Trebuchet MS', bodyFont: 'Trebuchet MS', decor: 'none' }
  }
]

export function themeById(id: string | undefined): SlideTheme {
  return SLIDE_TEMPLATES.find((template) => template.id === id)?.theme ?? DEFAULT_THEME
}

// ---- Element constructors ---------------------------------------------------------------

type Rect = Pick<Box, 'x' | 'y' | 'w' | 'h'>

export function textBox(partial: Partial<SlideText> & Rect): SlideText {
  return {
    id: uuidv7(),
    type: 'text',
    text: '',
    fontFamily: 'Calibri',
    fontSize: 18,
    bold: false,
    italic: false,
    underline: false,
    color: DEFAULT_TEXT_COLOR,
    align: 'left',
    valign: 'top',
    list: 'none',
    rotation: 0,
    opacity: 1,
    ...partial
  }
}

export function shapeElement(shape: SlideShapeKind, partial: Partial<SlideShape> & Rect): SlideShape {
  const line = shape === 'line'
  return { id: uuidv7(), type: 'shape', shape, fill: '#3b82f6', stroke: line ? '#1f2937' : '#1e3a8a', strokeWidth: line ? 3 : 0, rotation: 0, opacity: 1, ...partial }
}

export function imageElement(src: string, rect: Rect): SlideImage {
  return { id: uuidv7(), type: 'image', src, rotation: 0, opacity: 1, ...rect }
}

// ---- Layouts ----------------------------------------------------------------------------

export const SLIDE_LAYOUTS = [
  { id: 'title', name: 'Title slide' },
  { id: 'titleContent', name: 'Title and content' },
  { id: 'twoColumn', name: 'Two columns' },
  { id: 'section', name: 'Section header' },
  { id: 'titleOnly', name: 'Title only' },
  { id: 'quote', name: 'Quote' },
  { id: 'bigNumber', name: 'Big number' },
  { id: 'pictureCaption', name: 'Picture with caption' },
  { id: 'blank', name: 'Blank' }
] as const
export type SlideLayoutId = (typeof SLIDE_LAYOUTS)[number]['id']

/** Shapes a theme draws behind the content of a slide. */
function decoration(theme: SlideTheme, w: number, h: number, prominent: boolean): SlideElement[] {
  const plain = { strokeWidth: 0, stroke: theme.accent }
  if (theme.decor === 'bar') {
    return prominent
      ? [shapeElement('rect', { ...plain, x: 0, y: 0, w: Math.round(w * 0.025), h, fill: theme.accent })]
      : [shapeElement('rect', { ...plain, x: Math.round(w * 0.0625), y: Math.round(h * 0.235), w: Math.round(w * 0.08), h: 4, fill: theme.accent })]
  }
  if (theme.decor === 'corner') {
    const size = Math.round(h * (prominent ? 0.5 : 0.26))
    return [
      shapeElement('ellipse', { ...plain, x: w - Math.round(size * 0.62), y: -Math.round(size * 0.42), w: size, h: size, fill: theme.accent2, opacity: 0.55 }),
      shapeElement('ellipse', { ...plain, x: w - Math.round(size * 0.3), y: Math.round(size * 0.08), w: Math.round(size * 0.55), h: Math.round(size * 0.55), fill: theme.accent, opacity: 0.8 })
    ]
  }
  if (theme.decor === 'band') {
    const band = Math.round(h * (prominent ? 0.07 : 0.03))
    return [shapeElement('rect', { ...plain, x: 0, y: h - band, w, h: band, fill: theme.accent })]
  }
  return []
}

/** A new slide in one of the standard layouts, in the deck's theme and slide size. */
export function buildSlide(layout: SlideLayoutId, theme: SlideTheme = DEFAULT_THEME, w = SLIDE_WIDTH, h = SLIDE_HEIGHT, title = ''): Slide {
  const m = Math.round(w * 0.0625)
  const inner = w - m * 2
  const heading = (partial: Partial<SlideText> & Rect): SlideText => textBox({ fontFamily: theme.headingFont, color: theme.title, bold: true, fontSize: 32, text: title, ...partial })
  const body = (partial: Partial<SlideText> & Rect): SlideText => textBox({ fontFamily: theme.bodyFont, color: theme.text, fontSize: 18, ...partial })
  const top = { x: m, y: Math.round(h * 0.08), w: inner, h: Math.round(h * 0.15) }
  const below = Math.round(h * 0.29)
  const tall = Math.round(h * 0.6)
  let elements: SlideElement[]

  switch (layout) {
    case 'title':
      elements = [
        ...decoration(theme, w, h, true),
        heading({ x: m, y: Math.round(h * 0.31), w: inner, h: Math.round(h * 0.2), fontSize: 44, align: 'center', valign: 'bottom' }),
        body({ x: m, y: Math.round(h * 0.54), w: inner, h: Math.round(h * 0.12), fontSize: 20, align: 'center', color: theme.muted })
      ]
      break
    case 'titleContent':
      elements = [...decoration(theme, w, h, false), heading(top), body({ x: m, y: below, w: inner, h: tall, list: 'bullet' })]
      break
    case 'twoColumn': {
      const column = Math.round((inner - m / 2) / 2)
      elements = [
        ...decoration(theme, w, h, false),
        heading(top),
        body({ x: m, y: below, w: column, h: tall, list: 'bullet' }),
        body({ x: w - m - column, y: below, w: column, h: tall, list: 'bullet' })
      ]
      break
    }
    case 'section':
      elements = [
        ...decoration(theme, w, h, true),
        heading({ x: m, y: Math.round(h * 0.36), w: inner, h: Math.round(h * 0.18), fontSize: 40, valign: 'bottom' }),
        shapeElement('rect', { x: m, y: Math.round(h * 0.57), w: Math.round(w * 0.12), h: 5, fill: theme.accent, stroke: theme.accent, strokeWidth: 0 }),
        body({ x: m, y: Math.round(h * 0.61), w: inner, h: Math.round(h * 0.1), color: theme.muted })
      ]
      break
    case 'titleOnly':
      elements = [...decoration(theme, w, h, false), heading(top)]
      break
    case 'quote':
      elements = [
        ...decoration(theme, w, h, false),
        textBox({ x: m, y: Math.round(h * 0.1), w: Math.round(w * 0.12), h: Math.round(h * 0.22), text: '“', fontFamily: 'Georgia', fontSize: 96, bold: true, color: theme.accent }),
        body({ x: Math.round(w * 0.14), y: Math.round(h * 0.28), w: Math.round(w * 0.72), h: Math.round(h * 0.34), fontSize: 28, italic: true, valign: 'middle', color: theme.title, text: title }),
        body({ x: Math.round(w * 0.14), y: Math.round(h * 0.66), w: Math.round(w * 0.72), h: Math.round(h * 0.08), fontSize: 16, color: theme.muted })
      ]
      break
    case 'bigNumber':
      elements = [
        ...decoration(theme, w, h, false),
        heading({ x: m, y: Math.round(h * 0.2), w: inner, h: Math.round(h * 0.34), fontSize: 96, align: 'center', valign: 'middle', color: theme.accent, text: title }),
        body({ x: m, y: Math.round(h * 0.58), w: inner, h: Math.round(h * 0.14), fontSize: 22, align: 'center' })
      ]
      break
    case 'pictureCaption': {
      const half = Math.round(inner * 0.52)
      elements = [
        ...decoration(theme, w, h, false),
        shapeElement('roundRect', { x: m, y: Math.round(h * 0.12), w: half, h: Math.round(h * 0.76), fill: theme.accent2, stroke: theme.accent, strokeWidth: 0, opacity: 0.6 }),
        heading({ x: m + half + Math.round(m / 2), y: Math.round(h * 0.2), w: inner - half - Math.round(m / 2), h: Math.round(h * 0.24), fontSize: 28, valign: 'bottom' }),
        body({ x: m + half + Math.round(m / 2), y: Math.round(h * 0.47), w: inner - half - Math.round(m / 2), h: Math.round(h * 0.36) })
      ]
      break
    }
    default:
      elements = []
  }
  return { id: uuidv7(), background: theme.background, notes: '', elements }
}

/** A slide with a title box and a body box, laid out for the given slide size. */
export function titleAndBodySlide(width = SLIDE_WIDTH, height = SLIDE_HEIGHT, title = '', theme: SlideTheme = DEFAULT_THEME): Slide {
  const slide = buildSlide('titleContent', theme, width, height, title)
  // The plain body has no list formatting; the bulleted variant is a layout choice.
  return { ...slide, elements: slide.elements.map((element, index) => (element.type === 'text' && index === slide.elements.length - 1 ? { ...element, list: 'none' as const } : element)) }
}

export function blankSlide(theme: SlideTheme = DEFAULT_THEME): Slide {
  return { id: uuidv7(), background: theme.background, notes: '', elements: [] }
}

/** A new presentation: one title slide, in the plain theme. */
export function emptyPresentation(title: string): Presentation {
  return { width: SLIDE_WIDTH, height: SLIDE_HEIGHT, theme: DEFAULT_THEME, slideNumbers: false, slides: [buildSlide('title', DEFAULT_THEME, SLIDE_WIDTH, SLIDE_HEIGHT, title)] }
}

/** A starter deck in one of the templates: title, agenda, two columns, quote, and closing slides. */
export function templatePresentation(templateId: string, title: string): Presentation {
  if (templateId === 'simple' || !SLIDE_TEMPLATES.some((template) => template.id === templateId)) return emptyPresentation(title)
  const theme = themeById(templateId)
  const make = (layout: SlideLayoutId, heading: string, fill: string[] = []): Slide => {
    const slide = buildSlide(layout, theme, SLIDE_WIDTH, SLIDE_HEIGHT, heading)
    // The remaining empty text boxes are filled in order with the sample text.
    let next = 0
    return { ...slide, elements: slide.elements.map((element) => (element.type === 'text' && element.text === '' && next < fill.length ? { ...element, text: fill[next++] } : element)) }
  }
  return {
    width: SLIDE_WIDTH,
    height: SLIDE_HEIGHT,
    theme,
    slideNumbers: false,
    slides: [
      make('title', title, ['Subtitle or your name']),
      make('titleContent', 'Agenda', ['First topic\nSecond topic\nThird topic']),
      make('twoColumn', 'Compare two ideas', ['Point one\nPoint two', 'Point one\nPoint two']),
      make('quote', 'A sentence worth remembering.', ['— Source']),
      make('section', 'Thank you', ['Questions?'])
    ]
  }
}

/**
 * Restyles a deck for another theme: every colour and font that came from the old theme is
 * swapped for the new theme's. Colours and fonts the user chose themselves are left alone, and
 * the old theme's decorative shapes stay (recoloured) rather than being redrawn.
 */
export function retheme(presentation: Presentation, next: SlideTheme): Presentation {
  const from = presentation.theme
  const colours = new Map<string, string>()
  for (const key of ['accent2', 'accent', 'muted', 'text', 'title', 'background'] as const) colours.set(from[key].toLowerCase(), next[key])
  const colour = (value: string): string => colours.get(value.toLowerCase()) ?? value
  const font = (element: SlideText): SlideFont => {
    if (from.headingFont === from.bodyFont) return element.fontFamily === from.bodyFont ? (element.bold && element.fontSize >= 28 ? next.headingFont : next.bodyFont) : element.fontFamily
    return element.fontFamily === from.headingFont ? next.headingFont : element.fontFamily === from.bodyFont ? next.bodyFont : element.fontFamily
  }
  return {
    ...presentation,
    theme: next,
    slides: presentation.slides.map((slide) => ({
      ...slide,
      background: colour(slide.background),
      elements: slide.elements.map((element) =>
        element.type === 'text'
          ? { ...element, color: colour(element.color), fontFamily: font(element) }
          : element.type === 'shape'
            ? { ...element, fill: colour(element.fill), stroke: colour(element.stroke) }
            : element
      )
    }))
  }
}

// ---- Shape geometry ---------------------------------------------------------------------

/** The outline of a shape as an SVG path in a `w` × `h` box. Mirrors PowerPoint's preset shapes. */
export function shapePath(shape: SlideShapeKind, w: number, h: number): string {
  const n = (value: number): string => String(Math.round(value * 100) / 100)
  const polygon = (points: [number, number][]): string => `M${points.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L')} Z`
  switch (shape) {
    case 'roundRect': {
      const r = Math.min(w, h) / 6
      return `M${n(r)} 0 H${n(w - r)} A${n(r)} ${n(r)} 0 0 1 ${n(w)} ${n(r)} V${n(h - r)} A${n(r)} ${n(r)} 0 0 1 ${n(w - r)} ${n(h)} H${n(r)} A${n(r)} ${n(r)} 0 0 1 0 ${n(h - r)} V${n(r)} A${n(r)} ${n(r)} 0 0 1 ${n(r)} 0 Z`
    }
    case 'ellipse':
      return `M0 ${n(h / 2)} A${n(w / 2)} ${n(h / 2)} 0 1 1 ${n(w)} ${n(h / 2)} A${n(w / 2)} ${n(h / 2)} 0 1 1 0 ${n(h / 2)} Z`
    case 'triangle':
      return polygon([[w / 2, 0], [w, h], [0, h]])
    case 'diamond':
      return polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]])
    case 'pentagon':
      return polygon([[w / 2, 0], [w, h * 0.382], [w * 0.809, h], [w * 0.191, h], [0, h * 0.382]])
    case 'hexagon': {
      const inset = Math.min(w, h) * 0.25
      return polygon([[inset, 0], [w - inset, 0], [w, h / 2], [w - inset, h], [inset, h], [0, h / 2]])
    }
    case 'star': {
      const rx = (w / 2) * 1.05146
      const ry = (h / 2) * 1.10557
      const points: [number, number][] = []
      for (let i = 0; i < 10; i++) {
        const angle = (-90 + i * 36) * (Math.PI / 180)
        const k = i % 2 === 0 ? 1 : 0.38197
        points.push([w / 2 + Math.cos(angle) * rx * k, ry + Math.sin(angle) * ry * k])
      }
      return polygon(points)
    }
    case 'arrow': {
      const head = Math.min(w, Math.min(w, h) * 0.5)
      return polygon([[0, h * 0.25], [w - head, h * 0.25], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h * 0.75], [0, h * 0.75]])
    }
    case 'line':
      return `M0 ${n(h / 2)} L${n(w)} ${n(h / 2)}`
    default:
      return `M0 0 H${n(w)} V${n(h)} H0 Z`
  }
}

// ---- Helpers ----------------------------------------------------------------------------

/** A copy of a slide with fresh ids, for "Duplicate slide". */
export function cloneSlide(slide: Slide): Slide {
  return { ...slide, id: uuidv7(), elements: slide.elements.map((element) => ({ ...element, id: uuidv7() })) }
}

/** Everything readable on the slides, for search. */
export function presentationText(presentation: Presentation): string {
  const parts: string[] = []
  for (const slide of presentation.slides) {
    for (const element of slide.elements) if (element.type === 'text' && element.text.trim()) parts.push(element.text.trim())
    if (slide.notes.trim()) parts.push(slide.notes.trim())
  }
  return parts.join('\n')
}

/** The text shown for a slide in lists: its first non-empty text box. */
export function slideTitle(slide: Slide): string {
  for (const element of slide.elements) {
    if (element.type === 'text' && element.text.trim()) return element.text.trim().split('\n')[0].slice(0, 80)
  }
  return ''
}

/** Keeps a box inside sensible limits: a minimum size, and never wholly off the slide. */
export function clampBox<T extends Rect>(box: T, width: number, height: number): T {
  const w = Math.max(MIN_ELEMENT_SIZE, Math.round(box.w))
  const h = Math.max(MIN_ELEMENT_SIZE, Math.round(box.h))
  const x = Math.min(width - MIN_ELEMENT_SIZE, Math.max(MIN_ELEMENT_SIZE - w, Math.round(box.x)))
  const y = Math.min(height - MIN_ELEMENT_SIZE, Math.max(MIN_ELEMENT_SIZE - h, Math.round(box.y)))
  return { ...box, x, y, w, h }
}

/** Degrees in 0..359, whole numbers. */
export function normalizeRotation(degrees: number): number {
  return ((Math.round(degrees) % 360) + 360) % 360
}

/**
 * Snaps a moving box to the slide's centre lines and edges when it is within `threshold`
 * pixels, and reports which centre guides are active.
 */
export function snapBox(box: Rect, width: number, height: number, threshold: number): { x: number; y: number; guideX: boolean; guideY: boolean } {
  let { x, y } = box
  let guideX = false
  let guideY = false
  if (Math.abs(x + box.w / 2 - width / 2) <= threshold) {
    x = width / 2 - box.w / 2
    guideX = true
  } else if (Math.abs(x) <= threshold) x = 0
  else if (Math.abs(x + box.w - width) <= threshold) x = width - box.w
  if (Math.abs(y + box.h / 2 - height / 2) <= threshold) {
    y = height / 2 - box.h / 2
    guideY = true
  } else if (Math.abs(y) <= threshold) y = 0
  else if (Math.abs(y + box.h - height) <= threshold) y = height - box.h
  return { x, y, guideX, guideY }
}

/** `#rgb`, `rrggbb`, and `#RRGGBB` all become `#rrggbb`; anything else becomes the fallback. */
export function normalizeColor(value: string | undefined | null, fallback: string): string {
  const raw = (value ?? '').trim().replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${[...raw].map((digit) => digit + digit).join('').toLowerCase()}`
  return fallback
}

export function normalizeFont(value: string | undefined | null, fallback: SlideFont = 'Calibri'): SlideFont {
  const wanted = (value ?? '').trim().toLowerCase()
  return SLIDE_FONTS.find((font) => font.toLowerCase() === wanted) ?? fallback
}
