import fsp from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { printDocumentHtml } from '../services/print-html'

// PDF export for documents: the document's HTML is printed by Chromium in a hidden window.
// The window that renders it is locked down: JavaScript is disabled, there is no preload, and
// the page's Content Security Policy (see print-html.ts) allows only inline styles and
// embedded images.

/** Renders the HTML in a hidden, script-free window and writes the resulting PDF to `targetPath`. */
export async function exportHtmlToPdf(bodyHtml: string, title: string, targetPath: string, tempDir: string): Promise<void> {
  await fsp.mkdir(tempDir, { recursive: true })
  // Loaded from a file because documents with embedded images exceed data: URL limits.
  const tempFile = path.join(tempDir, `export-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  await fsp.writeFile(tempFile, printDocumentHtml(bodyHtml, title), 'utf8')
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true }
  })
  try {
    await win.loadFile(tempFile)
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
    await fsp.writeFile(targetPath, pdf)
  } finally {
    win.destroy()
    await fsp.rm(tempFile, { force: true })
  }
}
