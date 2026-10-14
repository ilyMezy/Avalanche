// The print appearance of exported documents (PDF). Pure: no Electron, no filesystem.
//
// The export never uses the app theme. This stylesheet is the single, neutral print appearance
// (black text on white, Word-like headings), so a document written in a dark theme exports
// exactly like one written in a light theme. Explicit formatting stored in the document
// (fonts, sizes, alignment, emphasis) arrives as inline styles and semantic tags and is kept.

const PRINT_CSS = `
  @page { size: A4; margin: 25.4mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #000; }
  p { margin: 0 0 8pt; }
  h1, h2, h3, h4 { font-family: 'Calibri Light', Calibri, 'Segoe UI', sans-serif; font-weight: 400; color: #2f5496; line-height: 1.25; margin: 12pt 0 4pt; break-after: avoid; }
  h1 { font-size: 16pt; } h2 { font-size: 13pt; } h3 { font-size: 12pt; color: #1f3763; } h4 { font-size: 11pt; font-style: italic; }
  ul { list-style: disc; padding-left: 28px; margin: 0 0 8pt; } ol { list-style: decimal; padding-left: 28px; margin: 0 0 8pt; }
  li p { margin: 0 0 2pt; }
  a { color: #0563c1; text-decoration: underline; }
  blockquote { margin: 0 0 8pt 36px; font-style: italic; }
  code, pre { font-family: Consolas, monospace; font-size: 10pt; }
  pre { background: #f5f5f5; padding: 8px 10px; margin: 0 0 8pt; white-space: pre-wrap; }
  hr { border: none; border-top: 1px solid #a0a0a0; margin: 10pt 0; }
  img { max-width: 100%; height: auto; display: block; margin: 4pt 0 8pt; break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; margin: 0 0 8pt; }
  td, th { border: 1px solid #8a8a8a; padding: 4px 7px; vertical-align: top; text-align: left; }
  th { background: #f2f2f2; font-weight: 700; }
  td p, th p { margin: 0; }
  tr { break-inside: avoid; }
  /* An explicit page break in the document model: everything after it starts a new page. */
  [data-page-break] { break-after: page; page-break-after: always; height: 0; margin: 0; padding: 0; border: 0; visibility: hidden; }
`

/**
 * Wraps a document's HTML for printing. The Content Security Policy allows nothing except
 * inline styles and embedded (data:) images, so the page can load no scripts or remote content.
 */
export function printDocumentHtml(bodyHtml: string, title: string): string {
  const safeTitle = title.replace(/[<>&"]/g, '')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${safeTitle}</title><style>${PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`
}
