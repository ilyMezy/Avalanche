import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  Copy,
  CopyPlus,
  FileWarning,
  Image as ImageIcon,
  Info,
  Italic,
  List,
  ListOrdered,
  Play,
  Plus,
  Redo2,
  RotateCw,
  Shapes,
  Trash2,
  Type,
  Underline,
  Undo2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  blankSlide,
  buildSlide,
  clampBox,
  cloneSlide,
  imageElement,
  MAX_SLIDES,
  normalizeRotation,
  retheme,
  SHAPE_KINDS,
  SHAPE_LABELS,
  shapeElement,
  SLIDE_FONTS,
  SLIDE_LAYOUTS,
  SLIDE_TEMPLATES,
  slideTitle,
  snapBox,
  textBox,
  type Presentation,
  type Slide,
  type SlideElement,
  type SlideFont,
  type SlideLayoutId,
  type SlideShapeKind,
  type SlideText
} from '@shared/domain/slides'
import { uuidv7 } from '@shared/domain/uuid'
import { useAppStore } from '@/app/store'
import { Button, IconButton, SCROLLING_TOOLBAR, scrollSideways, ToolbarGroup } from '@/components/ui/button'
import { Select, Textarea } from '@/components/ui/controls'
import { EmptyState, SaveProblemBanner, Spinner, toast } from '@/components/ui/feedback'
import { ActionMenu, ContextArea, type MenuEntry } from '@/components/ui/overlays'
import { call, errorMessage } from '@/lib/api'
import { invalidate } from '@/lib/useData'
import { useSaver } from '@/lib/useSaver'
import { cn } from '@/lib/utils'
import { boxStyle, ElementContent, Presenter, ShapeGraphic, SlideView, textStyle } from './SlideView'

const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 60, 72, 96]
const OUTLINE_WIDTHS = [0, 1, 2, 3, 4, 6, 8, 12]
const OPACITIES = [1, 0.75, 0.5, 0.25]
const THUMB_WIDTH = 132
const HISTORY_LIMIT = 100
const SNAP_PIXELS = 6
const GUIDE_COLOR = '#ec4899'
const COMPACT_SELECT = 'h-7 shrink-0 border-transparent bg-transparent px-2 text-xs hover:border-line-strong hover:bg-hover focus:bg-bg'
type Panel = 'slides' | 'elements' | 'layouts'

function naturalSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new window.Image()
    image.onload = () => resolve({ width: image.naturalWidth || 400, height: image.naturalHeight || 300 })
    image.onerror = () => resolve({ width: 400, height: 300 })
    image.src = dataUrl
  })
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }): ReactNode {
  return (
    <label className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted hover:bg-hover" title={label}>
      <span>{label}</span>
      <input type="color" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0" />
    </label>
  )
}

function PanelHeading({ children }: { children: ReactNode }): ReactNode {
  return <div className="mt-3 mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase first:mt-0">{children}</div>
}

/**
 * The slide editor: a side panel (slides, elements to add, layouts and deck style), a stage
 * where text, pictures, and shapes are placed and edited directly, and speaker notes. The
 * presentation is saved as a real `.pptx` by the main process.
 */
export function SlidesEditor({ entryId }: { entryId: string }): ReactNode {
  const saveState = useAppStore((state) => state.saveStates[entryId])
  const setStatusText = useAppStore((state) => state.setStatusText)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [importNotice, setImportNotice] = useState<string[] | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [presentation, setPresentation] = useState<Presentation | null>(null)
  const [index, setIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [presenting, setPresenting] = useState(false)
  const [panel, setPanel] = useState<Panel>('slides')
  const [guides, setGuides] = useState({ x: false, y: false })
  const [scale, setScale] = useState(0.5)
  const [, setHistoryVersion] = useState(0)

  const current = useRef<Presentation | null>(null)
  const version = useRef('')
  const undoStack = useRef<Presentation[]>([])
  const redoStack = useRef<Presentation[]>([])
  const clipboard = useRef<SlideElement | null>(null)
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const stage = useRef<HTMLDivElement>(null)
  /** The state before the current run of typing, pushed to history on its first change. */
  const typingOrigin = useRef<Presentation | null>(null)

  const saver = useSaver(entryId, async (force) => {
    if (!current.current) return
    const result = await call('slides.write', { id: entryId, presentation: current.current, baseVersion: version.current, force })
    version.current = result.version
    invalidate('workspace')
  })

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    call('slides.read', { id: entryId }).then(
      (document) => {
        if (cancelled) return
        version.current = document.version
        current.current = document.presentation
        undoStack.current = []
        redoStack.current = []
        setPresentation(document.presentation)
        setIndex(0)
        setSelectedId(null)
        setEditingId(null)
        saver.reset()
        setImportNotice(document.imported ? document.importWarnings : null)
        setStatus('ready')
      },
      (error: unknown) => {
        if (cancelled) return
        setLoadError(errorMessage(error))
        setStatus('error')
      }
    )
    return () => {
      cancelled = true
    }
  }, [entryId, reloadCount, saver])

  const slideCount = presentation?.slides.length ?? 0
  const slideIndex = Math.min(index, Math.max(0, slideCount - 1))
  const slide = presentation?.slides[slideIndex]
  const selected = slide?.elements.find((element) => element.id === selectedId) ?? null

  useEffect(() => {
    if (status === 'ready') setStatusText(entryId, `Slide ${slideIndex + 1} of ${slideCount}`)
  }, [entryId, setStatusText, slideCount, slideIndex, status])

  // The stage is scaled to fit the space available for it.
  useLayoutEffect(() => {
    const host = stage.current
    if (!host || !presentation) return
    const fit = (): void => {
      const next = Math.min((host.clientWidth - 48) / presentation.width, (host.clientHeight - 48) / presentation.height, 2)
      setScale(Math.max(0.1, next))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(host)
    return () => observer.disconnect()
  }, [presentation?.width, presentation?.height, status]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Changes and history --------------------------------------------------------------

  /** Shows a new state without recording it; used while dragging and typing. */
  const show = useCallback((next: Presentation) => {
    current.current = next
    setPresentation(next)
  }, [])

  /** Records `origin` as the state to return to, and marks the document unsaved. */
  const commitFrom = useCallback(
    (origin: Presentation) => {
      undoStack.current.push(origin)
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift()
      redoStack.current = []
      setHistoryVersion((value) => value + 1)
      saver.markDirty()
    },
    [saver]
  )

  const apply = useCallback(
    (next: Presentation) => {
      const origin = current.current
      if (!origin) return
      show(next)
      commitFrom(origin)
    },
    [commitFrom, show]
  )

  const stepHistory = useCallback(
    (from: Presentation[], to: Presentation[]) => {
      const target = from.pop()
      if (!target || !current.current) return
      to.push(current.current)
      show(target)
      setIndex((value) => Math.min(value, target.slides.length - 1))
      setEditingId(null)
      setHistoryVersion((value) => value + 1)
      saver.markDirty()
    },
    [saver, show]
  )
  const undo = useCallback(() => stepHistory(undoStack.current, redoStack.current), [stepHistory])
  const redo = useCallback(() => stepHistory(redoStack.current, undoStack.current), [stepHistory])

  const withSlide = (source: Presentation, at: number, change: (slide: Slide) => Slide): Presentation => ({
    ...source,
    slides: source.slides.map((candidate, position) => (position === at ? change(candidate) : candidate))
  })
  const withElement = (source: Presentation, at: number, id: string, patch: Partial<SlideElement>): Presentation =>
    withSlide(source, at, (target) => ({
      ...target,
      elements: target.elements.map((element) => (element.id === id ? ({ ...element, ...patch } as SlideElement) : element))
    }))

  const patchSelected = (patch: Partial<SlideElement>): void => {
    if (current.current && selected) apply(withElement(current.current, slideIndex, selected.id, patch))
  }

  // ---- Slides ---------------------------------------------------------------------------

  const insertSlide = (make: (source: Presentation) => Slide, at = slideIndex + 1): void => {
    const source = current.current
    if (!source) return
    if (source.slides.length >= MAX_SLIDES) {
      toast(`A presentation can have at most ${MAX_SLIDES} slides.`)
      return
    }
    const slides = [...source.slides]
    slides.splice(at, 0, make(source))
    apply({ ...source, slides })
    setIndex(at)
    setSelectedId(null)
  }
  const insertLayout = (layout: SlideLayoutId, at?: number): void => insertSlide((source) => buildSlide(layout, source.theme, source.width, source.height), at)

  const deleteSlide = (at: number): void => {
    const source = current.current
    if (!source) return
    // A presentation always keeps one slide; deleting the last one leaves it blank.
    const slides = source.slides.length === 1 ? [blankSlide(source.theme)] : source.slides.filter((_, position) => position !== at)
    apply({ ...source, slides })
    setIndex(Math.min(at, slides.length - 1))
    setSelectedId(null)
  }

  const moveSlide = (at: number, delta: number): void => {
    const source = current.current
    const target = at + delta
    if (!source || target < 0 || target >= source.slides.length) return
    const slides = [...source.slides]
    const [moved] = slides.splice(at, 1)
    slides.splice(target, 0, moved)
    apply({ ...source, slides })
    setIndex(target)
  }

  // ---- Elements -------------------------------------------------------------------------

  const addElement = (element: SlideElement): void => {
    const source = current.current
    if (!source) return
    apply(withSlide(source, slideIndex, (target) => ({ ...target, elements: [...target.elements, element] })))
    setSelectedId(element.id)
    stage.current?.focus()
  }

  const addText = (preset: 'heading' | 'subheading' | 'body' | 'list' | 'plain'): void => {
    const source = current.current
    if (!source) return
    const { theme, width, height } = source
    const box = { x: Math.round(width * 0.2), y: Math.round(height * 0.4), w: Math.round(width * 0.6), h: 60 }
    const element =
      preset === 'heading'
        ? textBox({ ...box, h: 72, fontFamily: theme.headingFont, fontSize: 36, bold: true, color: theme.title })
        : preset === 'subheading'
          ? textBox({ ...box, h: 52, fontFamily: theme.headingFont, fontSize: 24, color: theme.title })
          : preset === 'list'
            ? textBox({ ...box, h: 140, fontFamily: theme.bodyFont, fontSize: 20, color: theme.text, list: 'bullet' })
            : textBox({ ...box, fontFamily: theme.bodyFont, fontSize: preset === 'plain' ? 24 : 18, color: theme.text })
    addElement(element)
    setEditingId(element.id)
  }

  const addShape = (shape: SlideShapeKind): void => {
    const source = current.current
    if (!source) return
    const size = Math.round(source.height * 0.3)
    const wide = shape === 'rect' || shape === 'roundRect' || shape === 'arrow' || shape === 'hexagon'
    const w = shape === 'line' ? Math.round(source.width * 0.4) : Math.round(size * (wide ? 1.4 : 1))
    const h = shape === 'line' ? 20 : size
    addElement(
      shapeElement(shape, { x: Math.round((source.width - w) / 2), y: Math.round((source.height - h) / 2), w, h, fill: source.theme.accent, stroke: source.theme.title, strokeWidth: shape === 'line' ? 3 : 0 })
    )
  }

  const addImage = async (): Promise<void> => {
    if (!presentation) return
    try {
      const picked = await call('documents.pickImage')
      if (!picked) return
      const natural = await naturalSize(picked.dataUrl)
      const fit = Math.min((presentation.width * 0.7) / natural.width, (presentation.height * 0.7) / natural.height, 1)
      const w = Math.round(natural.width * fit)
      const h = Math.round(natural.height * fit)
      addElement(imageElement(picked.dataUrl, { x: Math.round((presentation.width - w) / 2), y: Math.round((presentation.height - h) / 2), w, h }))
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const removeSelected = (): void => {
    const source = current.current
    if (!source || !selected) return
    apply(withSlide(source, slideIndex, (target) => ({ ...target, elements: target.elements.filter((element) => element.id !== selected.id) })))
    setSelectedId(null)
  }

  /** Adds a copy of an element to the current slide, slightly offset, and selects it. */
  const pasteElement = (original: SlideElement, fromClipboard = false): void => {
    const source = current.current
    if (!source) return
    const copy = clampBox({ ...original, id: uuidv7(), x: original.x + 16, y: original.y + 16 }, source.width, source.height)
    apply(withSlide(source, slideIndex, (target) => ({ ...target, elements: [...target.elements, copy] })))
    setSelectedId(copy.id)
    // Pasting again places the next copy a step further on.
    if (fromClipboard) clipboard.current = copy
  }

  const reorderSelected = (toFront: boolean): void => {
    const source = current.current
    if (!source || !selected) return
    apply(
      withSlide(source, slideIndex, (target) => {
        const rest = target.elements.filter((element) => element.id !== selected.id)
        return { ...target, elements: toFront ? [...rest, selected] : [selected, ...rest] }
      })
    )
  }

  /** Dragging an element moves it, its corner handle resizes it, and its top handle rotates it. */
  const startDrag = (event: ReactPointerEvent, element: SlideElement, mode: 'move' | 'resize' | 'rotate'): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    if (editingId === element.id) return
    setSelectedId(element.id)
    setEditingId(null)
    stage.current?.focus()
    const origin = current.current
    if (!origin) return
    const startX = event.clientX
    const startY = event.clientY
    const frame = (event.currentTarget as HTMLElement).closest('[data-testid="slide-element"]')?.getBoundingClientRect()
    const centre = frame ? { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 } : { x: startX, y: startY }
    const radians = (element.rotation * Math.PI) / 180
    let moved = false
    const onMove = (move: PointerEvent): void => {
      const dx = (move.clientX - startX) / scaleRef.current
      const dy = (move.clientY - startY) / scaleRef.current
      if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return
      moved = true
      if (mode === 'rotate') {
        const angle = (Math.atan2(move.clientY - centre.y, move.clientX - centre.x) * 180) / Math.PI + 90
        // Rotation settles on multiples of 15 degrees when close to one, or always with Shift held.
        const nearest = Math.round(angle / 15) * 15
        show(withElement(origin, slideIndex, element.id, { rotation: normalizeRotation(move.shiftKey || Math.abs(angle - nearest) < 4 ? nearest : angle) }))
      } else if (mode === 'move') {
        const snapped = snapBox({ x: element.x + dx, y: element.y + dy, w: element.w, h: element.h }, origin.width, origin.height, move.altKey ? 0 : SNAP_PIXELS / scaleRef.current)
        setGuides({ x: snapped.guideX, y: snapped.guideY })
        show(withElement(origin, slideIndex, element.id, clampBox({ x: snapped.x, y: snapped.y, w: element.w, h: element.h }, origin.width, origin.height)))
      } else {
        // The pointer's movement is measured along the element's own (rotated) axes.
        const localX = dx * Math.cos(radians) + dy * Math.sin(radians)
        const localY = -dx * Math.sin(radians) + dy * Math.cos(radians)
        show(withElement(origin, slideIndex, element.id, clampBox({ x: element.x, y: element.y, w: element.w + localX, h: element.h + localY }, origin.width, origin.height)))
      }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setGuides({ x: false, y: false })
      if (moved) commitFrom(origin)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const typeInto = (element: SlideText, text: string): void => {
    const source = current.current
    if (!source) return
    const first = typingOrigin.current === null
    if (first) typingOrigin.current = source
    show(withElement(source, slideIndex, element.id, { text }))
    if (first) commitFrom(source)
    else saver.markDirty()
  }

  useEffect(() => {
    typingOrigin.current = null
  }, [editingId])

  // Shortcuts work wherever focus is inside the editor (a toolbar button keeps focus after it is
  // used), except while typing in a field.
  const onEditorKey = (event: KeyboardEvent): void => {
    if (editingId) return
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, select, [role="menu"], [role="dialog"]')) return
    const key = event.key
    if (target.closest('button') && (key === 'Enter' || key === ' ')) return
    const letter = key.toLowerCase()
    const command = event.ctrlKey || event.metaKey
    if (command && letter === 'z') {
      if (event.shiftKey) redo()
      else undo()
    } else if (command && letter === 'y') redo()
    else if (command && letter === 'd' && selected) pasteElement(selected)
    else if (command && letter === 'c' && selected) clipboard.current = selected
    else if (command && letter === 'x' && selected) {
      clipboard.current = selected
      removeSelected()
    } else if (command && letter === 'v' && clipboard.current) pasteElement(clipboard.current, true)
    else if ((key === 'Delete' || key === 'Backspace') && selected) removeSelected()
    else if ((key === 'Enter' || key === 'F2') && selected?.type === 'text') setEditingId(selected.id)
    else if (key === 'Escape' && selected) setSelectedId(null)
    else if (key.startsWith('Arrow') && selected && current.current) {
      const step = event.shiftKey ? 10 : 1
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0
      const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
      patchSelected(clampBox({ x: selected.x + dx, y: selected.y + dy, w: selected.w, h: selected.h }, current.current.width, current.current.height))
    } else if (key === 'PageDown' || (key === 'ArrowDown' && !selected)) setIndex(Math.min(slideCount - 1, slideIndex + 1))
    else if (key === 'PageUp' || (key === 'ArrowUp' && !selected)) setIndex(Math.max(0, slideIndex - 1))
    else return
    event.preventDefault()
  }

  if (status === 'error') return <EmptyState icon={<FileWarning size={18} />} title="This presentation could not be opened" body={loadError} />
  if (status === 'loading' || !presentation || !slide) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const { theme } = presentation
  const layoutItems: MenuEntry[] = SLIDE_LAYOUTS.map((layout) => ({ label: layout.name, onSelect: () => insertLayout(layout.id) }))
  const shapeItems: MenuEntry[] = SHAPE_KINDS.map((shape) => ({ label: SHAPE_LABELS[shape], onSelect: () => addShape(shape) }))
  const text = selected?.type === 'text' ? selected : null
  const shape = selected?.type === 'shape' ? selected : null
  const panelButton = 'flex h-8 w-full items-center gap-2 rounded-md border border-line bg-bg px-2.5 text-left text-xs text-fg hover:border-line-strong hover:bg-hover'

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onEditorKey}>
      {/* The controls change with the selection, so instead of wrapping (which would move the slide
          under the pointer) they scroll sideways, with a scroll bar, when they do not fit. Present
          stays in view. */}
      <div className="flex h-10 shrink-0 items-center border-b border-line bg-bg">
        <div role="toolbar" aria-label="Slides" className={`${SCROLLING_TOOLBAR} h-full min-w-0 flex-1 px-2`} onWheel={scrollSideways}>
          <ToolbarGroup divider>
            <IconButton label="Undo" shortcut="Ctrl+Z" disabled={undoStack.current.length === 0} onClick={undo}>
              <Undo2 size={15} />
            </IconButton>
            <IconButton label="Redo" shortcut="Ctrl+Y" disabled={redoStack.current.length === 0} onClick={redo}>
              <Redo2 size={15} />
            </IconButton>
          </ToolbarGroup>
          <ToolbarGroup divider>
            <ActionMenu items={layoutItems}>
              <IconButton label="New slide">
                <Plus size={15} />
              </IconButton>
            </ActionMenu>
            <IconButton label="Duplicate slide" onClick={() => insertSlide((source) => cloneSlide(source.slides[slideIndex]))}>
              <Copy size={15} />
            </IconButton>
          </ToolbarGroup>
          <ToolbarGroup divider>
            <IconButton label="Text box" onClick={() => addText('plain')}>
              <Type size={15} />
            </IconButton>
            <IconButton label="Picture" onClick={() => void addImage()}>
              <ImageIcon size={15} />
            </IconButton>
            <ActionMenu items={shapeItems}>
              <IconButton label="Shapes">
                <Shapes size={15} />
              </IconButton>
            </ActionMenu>
          </ToolbarGroup>

          {text && (
            <>
              <ToolbarGroup>
                <Select aria-label="Font" className={`${COMPACT_SELECT} w-[124px]`} value={text.fontFamily} onChange={(event) => patchSelected({ fontFamily: event.target.value as SlideFont })}>
                  {SLIDE_FONTS.map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Font size" className={`${COMPACT_SELECT} w-[62px]`} value={text.fontSize} onChange={(event) => patchSelected({ fontSize: Number(event.target.value) })}>
                  {(FONT_SIZES.includes(text.fontSize) ? FONT_SIZES : [...FONT_SIZES, text.fontSize].sort((a, b) => a - b)).map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </Select>
              </ToolbarGroup>
              <ToolbarGroup>
                <IconButton label="Bold" active={text.bold} onClick={() => patchSelected({ bold: !text.bold })}>
                  <Bold size={15} />
                </IconButton>
                <IconButton label="Italic" active={text.italic} onClick={() => patchSelected({ italic: !text.italic })}>
                  <Italic size={15} />
                </IconButton>
                <IconButton label="Underline" active={text.underline} onClick={() => patchSelected({ underline: !text.underline })}>
                  <Underline size={15} />
                </IconButton>
                <ColorInput label="Text" value={text.color} onChange={(color) => patchSelected({ color })} />
              </ToolbarGroup>
              <ToolbarGroup>
                <IconButton label="Align left" active={text.align === 'left'} onClick={() => patchSelected({ align: 'left' })}>
                  <AlignLeft size={15} />
                </IconButton>
                <IconButton label="Align center" active={text.align === 'center'} onClick={() => patchSelected({ align: 'center' })}>
                  <AlignCenter size={15} />
                </IconButton>
                <IconButton label="Align right" active={text.align === 'right'} onClick={() => patchSelected({ align: 'right' })}>
                  <AlignRight size={15} />
                </IconButton>
                <Select aria-label="Vertical alignment" className={`${COMPACT_SELECT} w-[84px]`} value={text.valign} onChange={(event) => patchSelected({ valign: event.target.value as SlideText['valign'] })}>
                  <option value="top">Top</option>
                  <option value="middle">Middle</option>
                  <option value="bottom">Bottom</option>
                </Select>
              </ToolbarGroup>
              <ToolbarGroup>
                <IconButton label="Bulleted list" active={text.list === 'bullet'} onClick={() => patchSelected({ list: text.list === 'bullet' ? 'none' : 'bullet' })}>
                  <List size={15} />
                </IconButton>
                <IconButton label="Numbered list" active={text.list === 'number'} onClick={() => patchSelected({ list: text.list === 'number' ? 'none' : 'number' })}>
                  <ListOrdered size={15} />
                </IconButton>
              </ToolbarGroup>
            </>
          )}
          {shape && (
            <ToolbarGroup>
              {shape.shape !== 'line' && <ColorInput label="Fill" value={shape.fill} onChange={(fill) => patchSelected({ fill })} />}
              <ColorInput label={shape.shape === 'line' ? 'Line' : 'Outline'} value={shape.stroke} onChange={(stroke) => patchSelected({ stroke })} />
              <Select aria-label="Outline width" className={`${COMPACT_SELECT} w-[72px]`} value={shape.strokeWidth} onChange={(event) => patchSelected({ strokeWidth: Number(event.target.value) })}>
                {(OUTLINE_WIDTHS.includes(shape.strokeWidth) ? OUTLINE_WIDTHS : [...OUTLINE_WIDTHS, shape.strokeWidth].sort((a, b) => a - b))
                  .filter((width) => shape.shape !== 'line' || width > 0)
                  .map((width) => (
                    <option key={width} value={width}>
                      {width === 0 ? 'None' : `${width} px`}
                    </option>
                  ))}
              </Select>
            </ToolbarGroup>
          )}
          {selected && (
            <>
              <ToolbarGroup>
                <Select aria-label="Opacity" className={`${COMPACT_SELECT} w-[72px]`} value={OPACITIES.includes(selected.opacity) ? selected.opacity : 1} onChange={(event) => patchSelected({ opacity: Number(event.target.value) })}>
                  {OPACITIES.map((value) => (
                    <option key={value} value={value}>
                      {Math.round(value * 100)}%
                    </option>
                  ))}
                </Select>
                <IconButton label="Rotate 90°" onClick={() => patchSelected({ rotation: normalizeRotation(selected.rotation + 90) })}>
                  <RotateCw size={15} />
                </IconButton>
                <IconButton label="Center horizontally" onClick={() => patchSelected({ x: Math.round((presentation.width - selected.w) / 2) })}>
                  <AlignCenterHorizontal size={15} />
                </IconButton>
                <IconButton label="Center vertically" onClick={() => patchSelected({ y: Math.round((presentation.height - selected.h) / 2) })}>
                  <AlignCenterVertical size={15} />
                </IconButton>
              </ToolbarGroup>
              <ToolbarGroup divider>
                <IconButton label="Bring to front" onClick={() => reorderSelected(true)}>
                  <ArrowUpToLine size={15} />
                </IconButton>
                <IconButton label="Send to back" onClick={() => reorderSelected(false)}>
                  <ArrowDownToLine size={15} />
                </IconButton>
                <IconButton label="Duplicate" shortcut="Ctrl+D" onClick={() => pasteElement(selected)}>
                  <CopyPlus size={15} />
                </IconButton>
                <IconButton label="Delete selection" shortcut="Delete" onClick={removeSelected}>
                  <Trash2 size={15} />
                </IconButton>
              </ToolbarGroup>
            </>
          )}
          <ToolbarGroup>
            <ColorInput label="Background" value={slide.background} onChange={(background) => current.current && apply(withSlide(current.current, slideIndex, (target) => ({ ...target, background })))} />
          </ToolbarGroup>
        </div>
        <Button size="sm" variant="primary" className="mx-2 shrink-0" onClick={() => setPresenting(true)}>
          <Play size={13} />
          Present
        </Button>
      </div>

      <SaveProblemBanner state={saveState} onReload={() => setReloadCount((count) => count + 1)} onOverwrite={() => void saver.overwrite()} onRetry={() => void saver.flush()} />
      {importNotice && (
        <div className="flex items-start gap-2.5 border-b border-line bg-raised px-4 py-2 text-xs text-muted" role="status">
          <Info size={14} className="mt-0.5 shrink-0 text-accent-text" />
          <span className="flex-1 leading-relaxed">
            This presentation was made in another program and has been converted for editing. Text, pictures, common shapes, lines, backgrounds, and notes
            are kept. The original file is kept in the app&apos;s recovery folder the first time you save.
            {importNotice.length > 0 && ` ${importNotice.slice(0, 4).join(' ')}`}
          </span>
          <button type="button" aria-label="Dismiss" className="text-subtle hover:text-fg" onClick={() => setImportNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[196px] shrink-0 flex-col border-r border-line bg-sidebar">
          <div role="tablist" aria-label="Slide panel" className="flex shrink-0 gap-0.5 border-b border-line p-1.5">
            {(['slides', 'elements', 'layouts'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={panel === id}
                onClick={() => setPanel(id)}
                className={cn('h-6 flex-1 rounded-md text-[11.5px] capitalize', panel === id ? 'bg-active font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg')}
              >
                {id}
              </button>
            ))}
          </div>

          {panel === 'slides' && (
            <div className="min-h-0 flex-1 overflow-y-auto p-2.5" role="listbox" aria-label="Slides">
              {presentation.slides.map((candidate, position) => {
                const items: MenuEntry[] = [
                  { label: 'New slide after', onSelect: () => insertLayout('titleContent', position + 1) },
                  { label: 'Duplicate', onSelect: () => insertSlide((source) => cloneSlide(source.slides[position]), position + 1) },
                  { type: 'separator' },
                  { label: 'Move up', disabled: position === 0, onSelect: () => moveSlide(position, -1) },
                  { label: 'Move down', disabled: position === slideCount - 1, onSelect: () => moveSlide(position, 1) },
                  { type: 'separator' },
                  { label: 'Delete slide', danger: true, onSelect: () => deleteSlide(position) }
                ]
                return (
                  <ContextArea key={candidate.id} items={items}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={position === slideIndex}
                      aria-label={`Slide ${position + 1}${slideTitle(candidate) ? `: ${slideTitle(candidate)}` : ''}`}
                      onClick={() => {
                        setIndex(position)
                        setSelectedId(null)
                        setEditingId(null)
                      }}
                      className="mb-2 flex w-full items-start gap-1.5 text-left"
                    >
                      <span className="w-4 shrink-0 pt-0.5 text-right text-[11px] text-subtle tabular-nums">{position + 1}</span>
                      <SlideView
                        slide={candidate}
                        width={presentation.width}
                        height={presentation.height}
                        scale={THUMB_WIDTH / presentation.width}
                        number={presentation.slideNumbers ? position + 1 : undefined}
                        numberColor={theme.muted}
                        className={cn('rounded-[3px] border', position === slideIndex ? 'border-accent ring-2 ring-accent/40' : 'border-line-strong')}
                      />
                    </button>
                  </ContextArea>
                )
              })}
            </div>
          )}

          {panel === 'elements' && (
            <div className="min-h-0 flex-1 overflow-y-auto p-2.5" role="tabpanel" aria-label="Elements">
              <PanelHeading>Text</PanelHeading>
              <div className="space-y-1.5">
                <button type="button" className={cn(panelButton, 'h-10 text-[15px] font-bold')} onClick={() => addText('heading')}>
                  Add a heading
                </button>
                <button type="button" className={cn(panelButton, 'text-[13px] font-medium')} onClick={() => addText('subheading')}>
                  Add a subheading
                </button>
                <button type="button" className={panelButton} onClick={() => addText('body')}>
                  Add body text
                </button>
                <button type="button" className={panelButton} onClick={() => addText('list')}>
                  <List size={13} /> Add a bulleted list
                </button>
              </div>
              <PanelHeading>Shapes and lines</PanelHeading>
              <div className="grid grid-cols-4 gap-1.5">
                {SHAPE_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    title={SHAPE_LABELS[kind]}
                    aria-label={`Add ${SHAPE_LABELS[kind].toLowerCase()}`}
                    onClick={() => addShape(kind)}
                    className="flex h-10 items-center justify-center rounded-md border border-line bg-bg p-2 text-muted hover:border-line-strong hover:bg-hover hover:text-fg"
                  >
                    <span className="block h-5 w-6">
                      <ShapeGraphic element={{ shape: kind, fill: 'currentColor', stroke: 'currentColor', strokeWidth: kind === 'line' ? 2 : 0, opacity: 1 }} width={24} height={20} />
                    </span>
                  </button>
                ))}
              </div>
              <PanelHeading>Pictures</PanelHeading>
              <button type="button" className={panelButton} onClick={() => void addImage()}>
                <ImageIcon size={13} /> Add a picture…
              </button>
              <p className="mt-3 text-[11px] leading-relaxed text-subtle">
                Drag to move; elements snap to the slide&apos;s centre and edges (hold Alt to move freely). Drag the round handle to rotate.
              </p>
            </div>
          )}

          {panel === 'layouts' && (
            <div className="min-h-0 flex-1 overflow-y-auto p-2.5" role="tabpanel" aria-label="Layouts">
              <PanelHeading>Deck style</PanelHeading>
              <Select
                aria-label="Deck style"
                className="h-7 w-full text-xs"
                value={SLIDE_TEMPLATES.some((template) => template.id === theme.id) ? theme.id : 'simple'}
                onChange={(event) => {
                  const next = SLIDE_TEMPLATES.find((template) => template.id === event.target.value)
                  if (next && current.current) apply(retheme(current.current, next.theme))
                }}
              >
                {SLIDE_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[11px] leading-relaxed text-subtle">Recolours the deck and sets the style of new slides.</p>
              <label className="mt-2 flex items-center gap-2 text-xs text-fg">
                <input type="checkbox" checked={presentation.slideNumbers} onChange={(event) => current.current && apply({ ...current.current, slideNumbers: event.target.checked })} />
                Show slide numbers
              </label>
              <PanelHeading>Add a slide</PanelHeading>
              {SLIDE_LAYOUTS.map((layout) => (
                <button key={layout.id} type="button" aria-label={`Add slide: ${layout.name}`} onClick={() => insertLayout(layout.id)} className="group mb-2 block w-full text-left">
                  <SlideView
                    slide={buildSlide(layout.id, theme, presentation.width, presentation.height, layout.id === 'bigNumber' ? '42' : layout.name)}
                    width={presentation.width}
                    height={presentation.height}
                    scale={170 / presentation.width}
                    className="rounded-[3px] border border-line-strong group-hover:border-accent"
                  />
                  <span className="mt-0.5 block text-[11px] text-muted group-hover:text-fg">{layout.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={stage}
            tabIndex={0}
            aria-label={`Slide ${slideIndex + 1} of ${slideCount}`}
            data-testid="slide-stage"
            className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-canvas outline-none"
            onPointerDown={() => {
              setSelectedId(null)
              setEditingId(null)
            }}
          >
            <SlideView
              slide={slide}
              width={presentation.width}
              height={presentation.height}
              scale={scale}
              number={presentation.slideNumbers ? slideIndex + 1 : undefined}
              numberColor={theme.muted}
              className="shadow-[0_2px_12px_rgba(0,0,0,0.28)]"
              overlay={
                <>
                  {guides.x && <div style={{ position: 'absolute', left: presentation.width / 2, top: 0, width: 1 / scale, height: presentation.height, background: GUIDE_COLOR, pointerEvents: 'none' }} />}
                  {guides.y && <div style={{ position: 'absolute', top: presentation.height / 2, left: 0, height: 1 / scale, width: presentation.width, background: GUIDE_COLOR, pointerEvents: 'none' }} />}
                </>
              }
              renderElement={(element) => {
                const isSelected = element.id === selectedId
                const isEditing = element.id === editingId && element.type === 'text'
                const handle = Math.max(8, 10 / scale)
                return (
                  <div
                    key={element.id}
                    data-testid="slide-element"
                    data-type={element.type}
                    data-shape={element.type === 'shape' ? element.shape : undefined}
                    style={boxStyle(element)}
                    className={cn('cursor-move', isSelected ? 'outline-2 outline-accent' : 'hover:outline hover:outline-accent/50')}
                    onPointerDown={(event) => startDrag(event, element, 'move')}
                    onDoubleClick={() => element.type === 'text' && setEditingId(element.id)}
                  >
                    {isEditing ? (
                      <textarea
                        autoFocus
                        aria-label="Text"
                        value={element.text}
                        style={{ ...textStyle(element), width: '100%', height: '100%', background: 'transparent', border: 0, outline: 'none', resize: 'none', padding: 0, overflow: 'hidden' }}
                        onChange={(event) => typeInto(element, event.target.value)}
                        onPointerDown={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            setEditingId(null)
                            stage.current?.focus()
                          }
                          event.stopPropagation()
                        }}
                        onBlur={() => setEditingId(null)}
                      />
                    ) : element.type === 'text' && element.text === '' ? (
                      // Shown only while editing the deck; an empty box is not drawn in the saved file.
                      <div style={{ ...textStyle(element), color: '#9ca3af', fontStyle: 'italic', fontWeight: 400, textDecoration: 'none' }}>Double-click to add text</div>
                    ) : (
                      <ElementContent element={element} />
                    )}
                    {isSelected && !isEditing && (
                      <>
                        <span
                          role="presentation"
                          data-testid="rotate-handle"
                          title="Drag to rotate"
                          className="absolute left-1/2 cursor-grab rounded-full border border-white bg-accent"
                          style={{ width: handle, height: handle, top: -handle * 2.6, marginLeft: -handle / 2 }}
                          onPointerDown={(event) => startDrag(event, element, 'rotate')}
                        />
                        <span
                          role="presentation"
                          data-testid="resize-handle"
                          className="absolute cursor-nwse-resize rounded-[2px] border border-white bg-accent"
                          style={{ width: handle, height: handle, right: -handle / 2, bottom: -handle / 2 }}
                          onPointerDown={(event) => startDrag(event, element, 'resize')}
                        />
                      </>
                    )}
                  </div>
                )
              }}
            />
          </div>
          <Textarea
            aria-label="Speaker notes"
            placeholder="Speaker notes for this slide"
            className="h-[68px] shrink-0 resize-none rounded-none border-x-0 border-b-0 text-xs"
            value={slide.notes}
            onChange={(event) => {
              const source = current.current
              if (!source) return
              const first = typingOrigin.current === null
              if (first) typingOrigin.current = source
              show(withSlide(source, slideIndex, (target) => ({ ...target, notes: event.target.value.slice(0, 20_000) })))
              if (first) commitFrom(source)
              else saver.markDirty()
            }}
            onBlur={() => {
              typingOrigin.current = null
            }}
          />
        </div>
      </div>

      {presenting && (
        <Presenter count={slideCount} start={slideIndex} onClose={() => setPresenting(false)}>
          {(position, size) => (
            <SlideView
              slide={presentation.slides[position]}
              width={presentation.width}
              height={presentation.height}
              scale={Math.min(size.width / presentation.width, size.height / presentation.height)}
              number={presentation.slideNumbers ? position + 1 : undefined}
              numberColor={theme.muted}
            />
          )}
        </Presenter>
      )}
    </div>
  )
}
