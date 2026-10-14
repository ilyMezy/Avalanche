import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// PDF.js and its worker are bundled with the app; nothing is fetched from the network.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type PdfDocument = pdfjs.PDFDocumentProxy

/** Opens PDF bytes. PDF.js takes ownership of the buffer it is given, so it receives a copy. */
export function openPdf(data: Uint8Array): pdfjs.PDFDocumentLoadingTask {
  return pdfjs.getDocument({ data: data.slice() })
}

/**
 * Draws one page onto a canvas so that it fits inside `maxWidth` × `maxHeight` CSS pixels.
 * `pixelRatio` is the backing-store density; pass 1 when the canvas is only a source for an image.
 */
export async function renderPdfPage(
  pdf: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  maxWidth: number,
  maxHeight: number,
  pixelRatio: number = window.devicePixelRatio || 1
): Promise<{ width: number; height: number }> {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const cssScale = Math.min(maxWidth / base.width, maxHeight / base.height)
  const viewport = page.getViewport({ scale: cssScale * pixelRatio })
  const width = Math.max(1, Math.floor(base.width * cssScale))
  const height = Math.max(1, Math.floor(base.height * cssScale))
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
  return { width, height }
}
