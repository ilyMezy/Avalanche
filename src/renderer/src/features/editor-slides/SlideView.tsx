import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { shapePath, type Slide, type SlideElement, type SlideShape, type SlideText } from '@shared/domain/slides'

// How a slide is drawn. The slide is laid out at its real size in slide pixels and scaled as a
// whole, so the thumbnail, the editing stage, and the presentation all show the same thing.
// Slide colours are document content: they come from the file, never from the app theme.

const ptToPx = (points: number): number => (points * 96) / 72
const FONT_FALLBACK = '"Segoe UI", Arial, sans-serif'

export function boxStyle(element: SlideElement): CSSProperties {
  return {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined
  }
}

export function textStyle(element: SlideText): CSSProperties {
  return {
    fontFamily: `"${element.fontFamily}", ${FONT_FALLBACK}`,
    fontSize: ptToPx(element.fontSize),
    fontWeight: element.bold ? 700 : 400,
    fontStyle: element.italic ? 'italic' : 'normal',
    textDecoration: element.underline ? 'underline' : 'none',
    color: element.color,
    textAlign: element.align,
    lineHeight: 1.2,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word'
  }
}

const VERTICAL = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const

function TextContent({ element }: { element: SlideText }): ReactNode {
  const lines = element.text.split('\n')
  let counter = 0
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: VERTICAL[element.valign], opacity: element.opacity }}>
      <div style={textStyle(element)}>
        {element.list === 'none'
          ? element.text
          : lines.map((line, index) =>
              line.trim() === '' ? (
                <div key={index}>&nbsp;</div>
              ) : (
                <div key={index} style={{ display: 'flex', textAlign: 'left' }}>
                  <span style={{ width: element.list === 'number' ? '1.7em' : '1.1em', flexShrink: 0 }}>{element.list === 'number' ? `${++counter}.` : '•'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{line}</span>
                </div>
              )
            )}
      </div>
    </div>
  )
}

export function ShapeGraphic({ element, width, height }: { element: Pick<SlideShape, 'shape' | 'fill' | 'stroke' | 'strokeWidth' | 'opacity'>; width: number; height: number }): ReactNode {
  const line = element.shape === 'line'
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible', opacity: element.opacity }} aria-hidden>
      <path
        d={shapePath(element.shape, width, height)}
        fill={line ? 'none' : element.fill}
        stroke={line || element.strokeWidth > 0 ? element.stroke : 'none'}
        strokeWidth={line ? Math.max(1, element.strokeWidth) : element.strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** The inside of an element, without its position. */
export function ElementContent({ element }: { element: SlideElement }): ReactNode {
  if (element.type === 'text') return <TextContent element={element} />
  if (element.type === 'image') return <img src={element.src} alt="" draggable={false} style={{ width: '100%', height: '100%', display: 'block', opacity: element.opacity }} />
  return <ShapeGraphic element={element} width={element.w} height={element.h} />
}

export function SlideView({
  slide,
  width,
  height,
  scale,
  className,
  number,
  numberColor,
  renderElement,
  overlay,
  onPointerDown
}: {
  slide: Slide
  width: number
  height: number
  scale: number
  className?: string
  /** The slide number to show in the corner, when the deck shows slide numbers. */
  number?: number
  numberColor?: string
  /** Replaces the plain drawing of each element; the editor uses it to add selection and dragging. */
  renderElement?: (element: SlideElement) => ReactNode
  /** Drawn above the elements in slide coordinates; the editor uses it for alignment guides. */
  overlay?: ReactNode
  onPointerDown?: () => void
}): ReactNode {
  return (
    <div className={className} style={{ width: width * scale, height: height * scale, overflow: 'hidden', flexShrink: 0 }}>
      <div
        data-testid="slide-surface"
        onPointerDown={onPointerDown}
        style={{ position: 'relative', width, height, transform: `scale(${scale})`, transformOrigin: '0 0', background: slide.background }}
      >
        {slide.elements.map((element) =>
          renderElement ? (
            renderElement(element)
          ) : (
            <div key={element.id} style={boxStyle(element)}>
              <ElementContent element={element} />
            </div>
          )
        )}
        {number !== undefined && (
          <div style={{ position: 'absolute', right: 20, bottom: 12, fontFamily: FONT_FALLBACK, fontSize: ptToPx(10), color: numberColor, pointerEvents: 'none' }}>{number}</div>
        )}
        {overlay}
      </div>
    </div>
  )
}

/**
 * Presentation mode: one slide at a time filling the window on black. Right, Space, Page Down,
 * or a click goes forward; Left or Page Up goes back; Escape leaves.
 */
export function Presenter({
  count,
  start,
  onClose,
  children
}: {
  count: number
  start: number
  onClose(): void
  children: (index: number, size: { width: number; height: number }) => ReactNode
}): ReactNode {
  const [index, setIndex] = useState(Math.min(start, count - 1))
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    host.current?.focus()
    const onResize = (): void => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const go = (delta: number): void => setIndex((current) => Math.min(count - 1, Math.max(0, current + delta)))

  return createPortal(
    <div
      ref={host}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Presentation, slide ${index + 1} of ${count}`}
      data-testid="presenter"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black outline-none"
      onClick={() => go(1)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
        else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ' || event.key === 'Enter') go(1)
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Backspace') go(-1)
        else if (event.key === 'Home') setIndex(0)
        else if (event.key === 'End') setIndex(count - 1)
        else return
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {children(index, size)}
      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-[11px] text-white/70">
        {index + 1} / {count} · Esc to exit
      </div>
    </div>,
    document.body
  )
}
