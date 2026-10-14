import { File, FileImage, FileText, FileType, Folder, FolderOpen, Hash, Presentation, Sigma } from 'lucide-react'
import type { ReactNode } from 'react'
import type { EntryKind } from '@shared/types'
import { cn } from '@/lib/utils'

export const KIND_LABELS: Record<EntryKind, string> = {
  folder: 'Folder',
  docx: 'Document',
  markdown: 'Markdown',
  latex_project: 'LaTeX project',
  slides: 'Slides',
  pdf: 'PDF',
  image: 'Image',
  other: 'File'
}

const COLORS: Record<EntryKind, string> = {
  folder: 'text-muted',
  docx: 'text-[#5b8def]',
  markdown: 'text-[#4fb886]',
  latex_project: 'text-[#d98a4b]',
  slides: 'text-[#e0a23a]',
  pdf: 'text-[#e06c66]',
  image: 'text-[#b28df0]',
  other: 'text-subtle'
}

/** File-type icon; the three document types are distinguished by both shape and colour. */
export function EntryIcon({ kind, open, size = 15, className }: { kind: EntryKind; open?: boolean; size?: number; className?: string }): ReactNode {
  const Icon =
    kind === 'folder'
      ? open
        ? FolderOpen
        : Folder
      : kind === 'docx'
        ? FileText
        : kind === 'markdown'
          ? Hash
          : kind === 'latex_project'
            ? Sigma
            : kind === 'slides'
              ? Presentation
              : kind === 'pdf'
              ? FileType
              : kind === 'image'
                ? FileImage
                : File
  return <Icon size={size} strokeWidth={1.9} className={cn('shrink-0', COLORS[kind], className)} aria-hidden />
}
