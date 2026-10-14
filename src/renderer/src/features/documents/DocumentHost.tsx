import type { ReactNode } from 'react'
import type { Tab } from '@/app/store'
import { loadable } from '@/lib/loadable'

// Each editor is a separate chunk, fetched the first time a document of its kind is opened, so
// starting the app does not load the word processor, the slide editor, and the PDF reader.
const DocxEditor = loadable(() => import('@/features/editor-docx/DocxEditor').then((module) => module.DocxEditor))
const LatexWorkspace = loadable(() => import('@/features/editor-latex/LatexWorkspace').then((module) => module.LatexWorkspace))
const MarkdownEditor = loadable(() => import('@/features/editor-markdown/MarkdownEditor').then((module) => module.MarkdownEditor))
const PdfSlidesView = loadable(() => import('@/features/editor-slides/PdfSlidesView').then((module) => module.PdfSlidesView))
const SlidesEditor = loadable(() => import('@/features/editor-slides/SlidesEditor').then((module) => module.SlidesEditor))

/** Chooses the editor that suits the document type; the surrounding shell is the same for all. */
export function DocumentHost({ tab, active }: { tab: Tab; active: boolean }): ReactNode {
  switch (tab.kind) {
    case 'docx':
      return <DocxEditor entryId={tab.id} />
    case 'latex_project':
      return <LatexWorkspace entryId={tab.id} active={active} />
    case 'markdown':
      return <MarkdownEditor entryId={tab.id} />
    case 'slides':
      return <SlidesEditor entryId={tab.id} />
    case 'pdf':
      return <PdfSlidesView entryId={tab.id} />
    default:
      return null
  }
}
