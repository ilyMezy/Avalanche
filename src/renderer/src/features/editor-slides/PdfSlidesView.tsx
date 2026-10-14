import { ChevronLeft, ChevronRight, FileWarning, Play, Presentation as PresentationIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { MAX_PDF_SLIDES, SLIDE_WIDTH } from '@shared/domain/slides'
import { openEntry } from '@/app/actions'
import { useAppStore } from '@/app/store'
import { Button, IconButton } from '@/components/ui/button'
import { EmptyState, Spinner, toast } from '@/components/ui/feedback'
import { call, errorMessage } from '@/lib/api'
import { openPdf, renderPdfPage, type PdfDocument } from '@/lib/pdf'
import { invalidate } from '@/lib/useData'
import { cn } from '@/lib/utils'
import { Presenter } from './SlideView'

const THUMB_WIDTH = 132
/** Width, in pixels, of the picture made from each page when converting to slides. */
const CONVERT_WIDTH = 1600

/** One PDF page drawn to fit a box. With `lazy`, it is drawn only once it scrolls into view. */
function PdfPage({ pdf, number, maxWidth, maxHeight, lazy, className }: { pdf: PdfDocument; number: number; maxWidth: number; maxHeight: number; lazy?: boolean; className?: string }): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(!lazy)

  useEffect(() => {
    const target = canvas.current
    if (!lazy || !target) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [lazy])

  useEffect(() => {
    const target = canvas.current
    if (!visible || !target || maxWidth <= 0 || maxHeight <= 0) return
    let cancelled = false
    // Drawn off-screen and copied over, so a superseded draw never lands on the visible canvas.
    const buffer = document.createElement('canvas')
    void renderPdfPage(pdf, number, buffer, maxWidth, maxHeight).then(
      (size) => {
        if (cancelled) return
        target.width = buffer.width
        target.height = buffer.height
        target.style.width = `${size.width}px`
        target.style.height = `${size.height}px`
        target.getContext('2d')!.drawImage(buffer, 0, 0)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [pdf, number, maxWidth, maxHeight, visible])

  return <canvas ref={canvas} aria-label={`Page ${number}`} className={cn('block bg-white', className)} style={lazy ? { width: maxWidth, minHeight: 40 } : undefined} />
}

/**
 * Shows a PDF as slides: a rail of page thumbnails, one page on the stage, and presentation
 * mode. A PDF's pages cannot be edited in place, so "Convert to editable slides" makes a new
 * presentation beside it with each page as a slide picture that can be annotated.
 */
export function PdfSlidesView({ entryId }: { entryId: string }): ReactNode {
  const setStatusText = useAppStore((state) => state.setStatusText)
  const [pdf, setPdf] = useState<PdfDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [presenting, setPresenting] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [area, setArea] = useState({ width: 0, height: 0 })
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof openPdf> | null = null
    setPdf(null)
    setError(null)
    call('slides.readPdf', { id: entryId })
      .then((data) => {
        if (cancelled) return null
        task = openPdf(data)
        return task.promise
      })
      .then(
        (document) => {
          if (cancelled || !document) return
          setPdf(document)
          setPage(1)
        },
        (cause: unknown) => {
          if (!cancelled) setError(errorMessage(cause))
        }
      )
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [entryId])

  const count = pdf?.numPages ?? 0

  useEffect(() => {
    if (pdf) setStatusText(entryId, `Page ${page} of ${count}`)
  }, [count, entryId, page, pdf, setStatusText])

  useLayoutEffect(() => {
    const host = stage.current
    if (!host) return
    const measure = (): void => setArea({ width: host.clientWidth - 48, height: host.clientHeight - 48 })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [pdf])

  const go = (delta: number): void => setPage((current) => Math.min(count, Math.max(1, current + delta)))

  const convert = async (): Promise<void> => {
    if (!pdf || progress) return
    if (count > MAX_PDF_SLIDES) {
      toast(`This PDF has ${count} pages. Up to ${MAX_PDF_SLIDES} pages can be converted to slides at once.`, 'error')
      return
    }
    try {
      const first = (await pdf.getPage(1)).getViewport({ scale: 1 })
      const width = SLIDE_WIDTH
      const height = Math.max(100, Math.round((SLIDE_WIDTH * first.height) / first.width))
      const pixelHeight = Math.round((CONVERT_WIDTH * height) / width)
      const pages: string[] = []
      for (let number = 1; number <= count; number++) {
        setProgress(`Converting page ${number} of ${count}…`)
        const rendered = document.createElement('canvas')
        await renderPdfPage(pdf, number, rendered, CONVERT_WIDTH, pixelHeight, 1)
        // Every slide has the size of the first page; a page of another shape is centred on white.
        const frame = document.createElement('canvas')
        frame.width = CONVERT_WIDTH
        frame.height = pixelHeight
        const context = frame.getContext('2d')!
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, frame.width, frame.height)
        context.drawImage(rendered, Math.round((frame.width - rendered.width) / 2), Math.round((frame.height - rendered.height) / 2))
        pages.push(frame.toDataURL('image/jpeg', 0.88))
      }
      setProgress('Creating the presentation…')
      const entry = await call('slides.fromPdf', { id: entryId, width, height, pages })
      invalidate('workspace')
      toast(`Created “${entry.name}” next to the PDF.`)
      await openEntry(entry)
    } catch (cause) {
      toast(errorMessage(cause), 'error')
    } finally {
      setProgress(null)
    }
  }

  if (error) return <EmptyState icon={<FileWarning size={18} />} title="This PDF could not be opened" body={error} />
  if (!pdf) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="toolbar" aria-label="PDF slides" className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-bg px-2">
        <IconButton label="Previous page" shortcut="Left" disabled={page <= 1} onClick={() => go(-1)}>
          <ChevronLeft size={15} />
        </IconButton>
        <span className="min-w-[92px] text-center text-xs text-muted tabular-nums" data-testid="pdf-slide-position">
          Page {page} of {count}
        </span>
        <IconButton label="Next page" shortcut="Right" disabled={page >= count} onClick={() => go(1)}>
          <ChevronRight size={15} />
        </IconButton>
        <span className="min-w-0 flex-1 truncate px-2 text-xs text-subtle">{progress ?? 'PDF pages are shown as they are. Convert them to slides to add text, pictures, and shapes.'}</span>
        <Button size="sm" className="shrink-0" disabled={progress !== null} onClick={() => void convert()}>
          <PresentationIcon size={13} />
          Convert to editable slides
        </Button>
        <Button size="sm" variant="primary" className="shrink-0" onClick={() => setPresenting(true)}>
          <Play size={13} />
          Present
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[180px] shrink-0 overflow-y-auto border-r border-line bg-sidebar p-2.5" role="listbox" aria-label="Pages">
          {Array.from({ length: count }, (_, position) => position + 1).map((number) => (
            <button key={number} type="button" role="option" aria-selected={number === page} aria-label={`Page ${number}`} onClick={() => setPage(number)} className="mb-2 flex w-full items-start gap-1.5 text-left">
              <span className="w-4 shrink-0 pt-0.5 text-right text-[11px] text-subtle tabular-nums">{number}</span>
              <PdfPage pdf={pdf} number={number} maxWidth={THUMB_WIDTH} maxHeight={THUMB_WIDTH * 2} lazy className={cn('rounded-[3px] border', number === page ? 'border-accent ring-2 ring-accent/40' : 'border-line-strong')} />
            </button>
          ))}
        </div>
        <div
          ref={stage}
          tabIndex={0}
          aria-label={`Page ${page} of ${count}`}
          data-testid="pdf-slide-stage"
          className="flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-canvas outline-none"
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') go(1)
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') go(-1)
            else if (event.key === 'Home') setPage(1)
            else if (event.key === 'End') setPage(count)
            else return
            event.preventDefault()
          }}
        >
          <PdfPage pdf={pdf} number={page} maxWidth={area.width} maxHeight={area.height} className="shadow-[0_2px_12px_rgba(0,0,0,0.28)]" />
        </div>
      </div>

      {presenting && (
        <Presenter count={count} start={page - 1} onClose={() => setPresenting(false)}>
          {(position, size) => <PdfPage pdf={pdf} number={position + 1} maxWidth={size.width} maxHeight={size.height} />}
        </Presenter>
      )}
    </div>
  )
}
