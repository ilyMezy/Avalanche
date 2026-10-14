import { isMod } from '@/lib/platform'
import { ArrowUpRight, Circle, Eraser, Grid3x3, Minus, Pencil, Redo2, Square, Trash2, Type, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Button, IconButton, ToolbarDivider } from '@/components/ui/button'
import { Segmented } from '@/components/ui/controls'
import { confirmDialog, promptDialog } from '@/components/ui/dialogs'
import { toast } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlays'
import { cn } from '@/lib/utils'

// An embedded drawing board for documents. Shapes are stored as data in a fixed 1200 × 750
// coordinate space, so a drawing is independent of screen size and zoom. The board itself is
// always white with mid-tone inks: it becomes a picture on a document page, which must read
// the same in every app theme and on paper.

export const BOARD_WIDTH = 1200
export const BOARD_HEIGHT = 750

type Tool = 'pen' | 'eraser' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text'
type Grid = 'none' | 'grid' | 'graph'

type Point = [number, number]
export type Shape =
  | { kind: 'pen'; color: string; width: number; points: Point[] }
  | { kind: 'line' | 'arrow' | 'rect' | 'ellipse'; color: string; width: number; from: Point; to: Point }
  | { kind: 'text'; color: string; size: number; at: Point; text: string }

export interface Drawing {
  shapes: Shape[]
  grid: Grid
}

const COLORS = ['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed']
const WIDTHS = [2, 4, 7]

const escapeXml = (text: string): string => text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)

function penPath(points: Point[]): string {
  if (points.length === 1) return `M${points[0][0]} ${points[0][1]} l0.01 0`
  // Quadratic segments through the midpoints give a smooth stroke from raw pointer samples.
  let d = `M${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i]
    const [nx, ny] = points[i + 1]
    d += ` Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`
  }
  const last = points[points.length - 1]
  return `${d} L${last[0]} ${last[1]}`
}

function shapeSvg(shape: Shape): string {
  if (shape.kind === 'pen') {
    return `<path d="${penPath(shape.points)}" fill="none" stroke="${shape.color}" stroke-width="${shape.width}" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  if (shape.kind === 'text') {
    return `<text x="${shape.at[0]}" y="${shape.at[1]}" fill="${shape.color}" font-family="Segoe UI, Arial, sans-serif" font-size="${shape.size}">${escapeXml(shape.text)}</text>`
  }
  const [x1, y1] = shape.from
  const [x2, y2] = shape.to
  const stroke = `fill="none" stroke="${shape.color}" stroke-width="${shape.width}" stroke-linecap="round" stroke-linejoin="round"`
  if (shape.kind === 'rect') return `<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" ${stroke}/>`
  if (shape.kind === 'ellipse') return `<ellipse cx="${(x1 + x2) / 2}" cy="${(y1 + y2) / 2}" rx="${Math.abs(x2 - x1) / 2}" ry="${Math.abs(y2 - y1) / 2}" ${stroke}/>`
  let out = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${stroke}/>`
  if (shape.kind === 'arrow') {
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const head = 10 + shape.width * 2.5
    const wing = (offset: number): string => `${x2 - head * Math.cos(angle + offset)} ${y2 - head * Math.sin(angle + offset)}`
    out += `<path d="M${wing(0.45)} L${x2} ${y2} L${wing(-0.45)}" ${stroke}/>`
  }
  return out
}

function gridSvg(grid: Grid): string {
  if (grid === 'none') return ''
  const lines: string[] = []
  const step = 25
  for (let x = 0; x <= BOARD_WIDTH; x += step) {
    const major = grid === 'graph' && x % 125 === 0
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${BOARD_HEIGHT}" stroke="${major ? '#b8c4d6' : '#e3e8ef'}" stroke-width="${major ? 1.2 : 0.8}"/>`)
  }
  for (let y = 0; y <= BOARD_HEIGHT; y += step) {
    const major = grid === 'graph' && y % 125 === 0
    lines.push(`<line x1="0" y1="${y}" x2="${BOARD_WIDTH}" y2="${y}" stroke="${major ? '#b8c4d6' : '#e3e8ef'}" stroke-width="${major ? 1.2 : 0.8}"/>`)
  }
  return lines.join('')
}

/** The drawing as a standalone SVG document on a white background. */
export function drawingToSvg(drawing: Drawing): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}"><rect width="100%" height="100%" fill="#ffffff"/>${gridSvg(drawing.grid)}${drawing.shapes.map(shapeSvg).join('')}</svg>`
}

/** Rasterizes the drawing to a PNG data URL, the format the document and its exports embed. */
export function drawingToPng(drawing: Drawing): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = BOARD_WIDTH
      canvas.height = BOARD_HEIGHT
      const context = canvas.getContext('2d')
      if (!context) return reject(new Error('The drawing could not be rendered.'))
      context.drawImage(image, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('The drawing could not be rendered.'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawingToSvg(drawing))}`
  })
}

export function parseDrawing(raw: string | null | undefined): Drawing | null {
  if (!raw) return null
  // Shapes come back from a document file, so they are validated before being drawn: only
  // known kinds, hex colours, and finite numbers are accepted, which keeps a tampered file
  // from injecting markup into the board.
  const point = (value: unknown): value is Point => Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n))
  const number = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max
  const colour = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
  const valid = (shape: Shape): boolean => {
    if (!shape || typeof shape !== 'object' || !colour(shape.color)) return false
    if (shape.kind === 'pen') return number(shape.width, 40) && Array.isArray(shape.points) && shape.points.length > 0 && shape.points.every(point)
    if (shape.kind === 'text') return number(shape.size, 200) && point(shape.at) && typeof shape.text === 'string'
    return ['line', 'arrow', 'rect', 'ellipse'].includes(shape.kind) && number(shape.width, 40) && point(shape.from) && point(shape.to)
  }
  try {
    const value = JSON.parse(raw) as Drawing
    if (!Array.isArray(value.shapes)) return null
    const grid: Grid = value.grid === 'grid' || value.grid === 'graph' ? value.grid : 'none'
    return { shapes: value.shapes.filter(valid).slice(0, 5000), grid }
  } catch {
    return null
  }
}

function hit(shape: Shape, [x, y]: Point, reach: number): boolean {
  const near = (px: number, py: number): boolean => Math.hypot(px - x, py - y) <= reach
  if (shape.kind === 'pen') return shape.points.some(([px, py]) => near(px, py))
  if (shape.kind === 'text') return x >= shape.at[0] - reach && x <= shape.at[0] + shape.text.length * shape.size * 0.6 && y >= shape.at[1] - shape.size && y <= shape.at[1] + reach
  const [x1, y1] = shape.from
  const [x2, y2] = shape.to
  if (shape.kind === 'rect' || shape.kind === 'ellipse') {
    return x >= Math.min(x1, x2) - reach && x <= Math.max(x1, x2) + reach && y >= Math.min(y1, y2) - reach && y <= Math.max(y1, y2) + reach
  }
  const length = Math.hypot(x2 - x1, y2 - y1) || 1
  const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / (length * length)))
  return near(x1 + t * (x2 - x1), y1 + t * (y2 - y1))
}

const TOOLS: { tool: Tool; label: string; icon: ReactNode }[] = [
  { tool: 'pen', label: 'Pencil', icon: <Pencil size={15} /> },
  { tool: 'eraser', label: 'Eraser (removes whole strokes)', icon: <Eraser size={15} /> },
  { tool: 'line', label: 'Line', icon: <Minus size={15} /> },
  { tool: 'arrow', label: 'Arrow', icon: <ArrowUpRight size={15} /> },
  { tool: 'rect', label: 'Rectangle', icon: <Square size={15} /> },
  { tool: 'ellipse', label: 'Ellipse', icon: <Circle size={15} /> },
  { tool: 'text', label: 'Text', icon: <Type size={15} /> }
]

/**
 * The whiteboard dialog. `onSave` receives the picture and the editable shapes; if it throws,
 * the dialog stays open with the drawing intact. Cancelling leaves the document untouched.
 */
export function Whiteboard({
  initial,
  onSave,
  onClose
}: {
  initial: Drawing | null
  onSave(result: { dataUrl: string; drawing: Drawing }): Promise<void> | void
  onClose(): void
}): ReactNode {
  const [shapes, setShapes] = useState<Shape[]>(initial?.shapes ?? [])
  const [redo, setRedo] = useState<Shape[][]>([])
  const [past, setPast] = useState<Shape[][]>([])
  const [draft, setDraft] = useState<Shape | null>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(WIDTHS[1])
  const [grid, setGrid] = useState<Grid>(initial?.grid ?? 'none')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const svg = useRef<SVGSVGElement>(null)
  const drawing = useRef(false)

  const commit = useCallback(
    (next: Shape[]) => {
      setPast((history) => [...history.slice(-99), shapes])
      setRedo([])
      setShapes(next)
      setDirty(true)
    },
    [shapes]
  )

  const undo = useCallback(() => {
    setPast((history) => {
      if (history.length === 0) return history
      setRedo((future) => [shapes, ...future])
      setShapes(history[history.length - 1])
      setDirty(true)
      return history.slice(0, -1)
    })
  }, [shapes])

  const redoStep = useCallback(() => {
    setRedo((future) => {
      if (future.length === 0) return future
      setPast((history) => [...history, shapes])
      setShapes(future[0])
      setDirty(true)
      return future.slice(1)
    })
  }, [shapes])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isMod(event)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        undo()
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault()
        event.stopPropagation()
        redoStep()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [undo, redoStep])

  /** Pointer position in board coordinates, whatever size the board is shown at. */
  const locate = (event: PointerEvent): Point => {
    const box = svg.current!.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * BOARD_WIDTH
    const y = ((event.clientY - box.top) / box.height) * BOARD_HEIGHT
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10]
  }

  const erase = (point: Point): void => {
    const index = [...shapes].reverse().findIndex((shape) => hit(shape, point, 10))
    if (index !== -1) commit(shapes.filter((_, i) => i !== shapes.length - 1 - index))
  }

  const onDown = (event: PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return
    const point = locate(event)
    if (tool === 'text') {
      void promptDialog({ title: 'Add text', label: 'Text', confirmLabel: 'Add' }).then((text) => {
        if (text) commit([...shapes, { kind: 'text', color, size: 14 + width * 3, at: point, text: text.slice(0, 200) }])
      })
      return
    }
    // Capturing the pointer keeps the stroke going when it leaves the board; pen and touch work the same way.
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true
    if (tool === 'eraser') erase(point)
    else if (tool === 'pen') setDraft({ kind: 'pen', color, width, points: [point] })
    else setDraft({ kind: tool, color, width, from: point, to: point })
  }

  const onMove = (event: PointerEvent<SVGSVGElement>): void => {
    if (!drawing.current) return
    const point = locate(event)
    if (tool === 'eraser') return erase(point)
    setDraft((current) => {
      if (!current) return current
      if (current.kind === 'pen') {
        const last = current.points[current.points.length - 1]
        return Math.hypot(point[0] - last[0], point[1] - last[1]) < 1.5 ? current : { ...current, points: [...current.points, point] }
      }
      return current.kind === 'text' ? current : { ...current, to: point }
    })
  }

  const onUp = (): void => {
    if (!drawing.current) return
    drawing.current = false
    if (draft) {
      const empty = draft.kind !== 'pen' && draft.kind !== 'text' && Math.hypot(draft.to[0] - draft.from[0], draft.to[1] - draft.from[1]) < 3
      if (!empty) commit([...shapes, draft])
      setDraft(null)
    }
  }

  const clear = async (): Promise<void> => {
    if (shapes.length === 0) return
    if (await confirmDialog({ title: 'Clear the whiteboard?', body: 'Everything on the board will be removed. You can still undo this.', confirmLabel: 'Clear', danger: true })) commit([])
  }

  const cancel = async (): Promise<void> => {
    if (dirty && !(await confirmDialog({ title: 'Discard this drawing?', body: 'Your changes to the whiteboard have not been inserted into the document.', confirmLabel: 'Discard', danger: true }))) return
    onClose()
  }

  const save = async (): Promise<void> => {
    if (shapes.length === 0) {
      toast('Draw something first, or cancel.')
      return
    }
    setSaving(true)
    try {
      const result: Drawing = { shapes, grid }
      await onSave({ dataUrl: await drawingToPng(result), drawing: result })
      onClose()
    } catch (error) {
      // The dialog stays open, so the drawing is not lost when inserting fails.
      toast(error instanceof Error ? error.message : 'The drawing could not be inserted.', 'error')
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && void cancel()}
      title="Whiteboard"
      className="top-[5%] max-h-[92vh] w-[1040px]"
      footer={
        <>
          <span className="mr-auto self-center text-xs text-subtle" data-testid="whiteboard-status">
            {dirty ? 'Unsaved changes' : shapes.length ? 'No changes' : 'Draw with the mouse or a pen'}
          </span>
          <Button onClick={() => void cancel()}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {initial ? 'Update drawing' : 'Insert into document'}
          </Button>
        </>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Drawing tools">
        {TOOLS.map((item) => (
          <IconButton key={item.tool} label={item.label} active={tool === item.tool} onClick={() => setTool(item.tool)}>
            {item.icon}
          </IconButton>
        ))}
        <ToolbarDivider />
        {COLORS.map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`Colour ${value}`}
            aria-pressed={color === value}
            onClick={() => setColor(value)}
            className={cn('mx-0.5 h-5 w-5 rounded-full border-2', color === value ? 'border-fg' : 'border-transparent')}
            style={{ background: value }}
          />
        ))}
        <ToolbarDivider />
        {WIDTHS.map((value) => (
          <IconButton key={value} label={`Stroke width ${value}`} active={width === value} onClick={() => setWidth(value)}>
            <span className="rounded-full bg-current" style={{ width: value + 3, height: value + 3 }} />
          </IconButton>
        ))}
        <ToolbarDivider />
        <IconButton label="Undo" shortcut="Ctrl+Z" disabled={past.length === 0} onClick={undo}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton label="Redo" shortcut="Ctrl+Y" disabled={redo.length === 0} onClick={redoStep}>
          <Redo2 size={15} />
        </IconButton>
        <IconButton label="Clear the board" disabled={shapes.length === 0} onClick={() => void clear()}>
          <Trash2 size={15} />
        </IconButton>
        <span className="flex-1" />
        <Grid3x3 size={13} className="mr-1.5 text-subtle" />
        <Segmented<Grid>
          label="Background"
          size="sm"
          value={grid}
          onChange={(value) => {
            setGrid(value)
            setDirty(true)
          }}
          options={[
            { value: 'none', label: 'Plain' },
            { value: 'grid', label: 'Grid' },
            { value: 'graph', label: 'Graph paper' }
          ]}
        />
      </div>
      {/* The board scales to fit the dialog; the viewBox keeps coordinates stable. */}
      <svg
        ref={svg}
        viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
        data-testid="whiteboard-canvas"
        className={cn('block w-full touch-none rounded-md border border-line-strong bg-white', tool === 'eraser' ? 'cursor-cell' : tool === 'text' ? 'cursor-text' : 'cursor-crosshair')}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        dangerouslySetInnerHTML={{ __html: gridSvg(grid) + shapes.map(shapeSvg).join('') + (draft ? shapeSvg(draft) : '') }}
      />
    </Modal>
  )
}
