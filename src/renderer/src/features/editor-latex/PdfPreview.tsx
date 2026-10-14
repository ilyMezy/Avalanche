import { Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconButton } from '@/components/ui/button'
import { openPdf } from '@/lib/pdf'

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2]

/** Renders compiled PDF bytes onto canvases, keeping the scroll position across recompiles. */
export function PdfPreview({ data }: { data: Uint8Array }): ReactNode {
  const scroller = useRef<HTMLDivElement>(null)
  const pages = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const host = pages.current
    const scroll = scroller.current
    if (!host || !scroll) return
    const previousScroll = scroll.scrollTop
    const task = openPdf(data)

    void (async () => {
      try {
        const pdf = await task.promise
        if (cancelled) return
        const canvases: HTMLCanvasElement[] = []
        const available = Math.max(240, scroll.clientWidth - 32)
        const ratio = window.devicePixelRatio || 1
        for (let number = 1; number <= pdf.numPages; number++) {
          const page = await pdf.getPage(number)
          if (cancelled) return
          const base = page.getViewport({ scale: 1 })
          const cssScale = (available / base.width) * zoom
          const viewport = page.getViewport({ scale: cssScale * ratio })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.width = `${Math.floor(base.width * cssScale)}px`
          canvas.style.height = `${Math.floor(base.height * cssScale)}px`
          canvas.className = 'mx-auto mb-3 block bg-white shadow-[0_1px_4px_rgba(0,0,0,0.25)]'
          canvas.setAttribute('aria-label', `Page ${number}`)
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
          canvases.push(canvas)
        }
        if (cancelled) return
        host.replaceChildren(...canvases)
        scroll.scrollTop = previousScroll
        setPageCount(pdf.numPages)
        setError(null)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'The PDF could not be displayed.')
      }
    })()

    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [data, zoom])

  const step = (direction: 1 | -1): void => {
    const index = ZOOM_STEPS.indexOf(zoom)
    setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction))])
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line bg-bg px-2 text-xs text-muted">
        <span className="flex-1 pl-1" data-testid="pdf-pages">
          {pageCount > 0 ? `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}` : 'PDF preview'}
        </span>
        <IconButton label="Zoom out" className="h-6 w-6" disabled={zoom === ZOOM_STEPS[0]} onClick={() => step(-1)}>
          <Minus size={13} />
        </IconButton>
        <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <IconButton label="Zoom in" className="h-6 w-6" disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={() => step(1)}>
          <Plus size={13} />
        </IconButton>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto p-4">
        {error && <p className="p-4 text-center text-xs text-danger">The PDF could not be displayed: {error}</p>}
        <div ref={pages} />
      </div>
    </div>
  )
}
