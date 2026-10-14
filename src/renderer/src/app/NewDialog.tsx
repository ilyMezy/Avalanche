import { FileText, Hash, Presentation, Sigma } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { validateName } from '@shared/domain/naming'
import { SLIDE_TEMPLATES } from '@shared/domain/slides'
import type { DocumentKind } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/controls'
import { toast } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlays'
import { FolderPicker } from '@/features/workspace/MoveDialog'
import { call, errorMessage } from '@/lib/api'
import { invalidate } from '@/lib/useData'
import { cn } from '@/lib/utils'
import { openEntry } from './actions'
import { useAppStore } from './store'

const CHOICES: { kind: DocumentKind; label: string; description: string; icon: ReactNode; defaultName: string; creates: string }[] = [
  {
    kind: 'docx',
    label: 'Document',
    description: 'Write essays, reports, assignments, and formatted documents.',
    icon: <FileText size={20} className="text-[#5b8def]" />,
    defaultName: 'Untitled document',
    creates: '.docx file'
  },
  {
    kind: 'slides',
    label: 'Slides',
    description: 'Build a presentation with text, pictures, and shapes, then present it.',
    icon: <Presentation size={20} className="text-[#e0a23a]" />,
    defaultName: 'Untitled presentation',
    creates: '.pptx file'
  },
  {
    kind: 'latex_project',
    label: 'LaTeX Project',
    description: 'Write academic papers with equations, references, and PDF output.',
    icon: <Sigma size={20} className="text-[#d98a4b]" />,
    defaultName: 'Untitled project',
    creates: 'project folder with main.tex'
  },
  {
    kind: 'markdown',
    label: 'Markdown Note',
    description: 'Capture ideas, write notes, and create lightweight documents.',
    icon: <Hash size={20} className="text-[#4fb886]" />,
    defaultName: 'Untitled note',
    creates: '.md file'
  }
]

/** The creation dialog behind the “New” button: one choice per document type. */
export function NewDialog(): ReactNode {
  const dialog = useAppStore((state) => state.newDialog)
  const [kind, setKind] = useState<DocumentKind>('docx')
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [parentPath, setParentPath] = useState('')
  const [choosingFolder, setChoosingFolder] = useState(false)
  const [template, setTemplate] = useState<'article' | 'report'>('article')
  const [slidesTemplate, setSlidesTemplate] = useState(SLIDE_TEMPLATES[0].id)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!dialog.open) return
    const initial = dialog.kind ?? 'docx'
    setKind(initial)
    setName(CHOICES.find((choice) => choice.kind === initial)!.defaultName)
    setNameEdited(false)
    setParentPath(dialog.parentPath)
    setChoosingFolder(false)
    setTemplate('article')
    setSlidesTemplate(SLIDE_TEMPLATES[0].id)
    setBusy(false)
  }, [dialog])

  const close = (): void => useAppStore.setState({ newDialog: { ...dialog, open: false } })
  const choice = CHOICES.find((candidate) => candidate.kind === kind)!
  const trimmed = name.trim()
  const problem = trimmed ? validateName(trimmed) : 'A name is required.'

  const pick = (next: DocumentKind): void => {
    setKind(next)
    if (!nameEdited) setName(CHOICES.find((candidate) => candidate.kind === next)!.defaultName)
  }

  const create = async (): Promise<void> => {
    if (problem || busy) return
    setBusy(true)
    try {
      const entry = await call('workspace.createDocument', {
        parentPath,
        name: trimmed,
        kind,
        template: kind === 'latex_project' ? template : undefined,
        slidesTemplate: kind === 'slides' ? slidesTemplate : undefined
      })
      invalidate('workspace')
      close()
      await openEntry(entry)
    } catch (error) {
      toast(errorMessage(error), 'error')
      setBusy(false)
    }
  }

  return (
    <Modal
      open={dialog.open}
      onOpenChange={(open) => !open && close()}
      title="Create new"
      className="w-[560px]"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={problem !== null || busy} onClick={() => void create()}>
            Create {choice.label.toLowerCase()}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void create()
        }}
        className="space-y-4"
      >
        <div role="radiogroup" aria-label="Document type" className="space-y-1.5">
          {CHOICES.map((option) => {
            const selected = option.kind === kind
            return (
              <button
                key={option.kind}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => pick(option.kind)}
                className={cn(
                  'flex w-full items-center gap-3.5 rounded-lg border px-3.5 py-3 text-left transition-colors duration-100',
                  selected ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong hover:bg-hover'
                )}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-bg">{option.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-fg">{option.label}</span>
                  <span className="block text-xs leading-snug text-muted">{option.description}</span>
                </span>
                <span className="shrink-0 text-[11px] text-subtle">{option.creates}</span>
              </button>
            )
          })}
        </div>

        <Field label="Name">
          <Input
            autoFocus
            value={name}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setName(event.target.value)
              setNameEdited(true)
            }}
            aria-invalid={problem !== null}
          />
          <span className="mt-1 block min-h-4 text-xs text-danger">{nameEdited && trimmed ? problem : ''}</span>
        </Field>

        {kind === 'slides' && (
          <div>
            <span className="mb-1.5 block text-xs font-medium text-muted">Template</span>
            <div role="radiogroup" aria-label="Slide template" className="grid grid-cols-4 gap-1.5">
              {SLIDE_TEMPLATES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={option.id === slidesTemplate}
                  title={option.description}
                  onClick={() => setSlidesTemplate(option.id)}
                  className={cn('rounded-md border p-1 text-left', option.id === slidesTemplate ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong')}
                >
                  {/* A miniature of the template: its own colours, which belong to the deck, not the app theme. */}
                  <span className="flex h-9 flex-col justify-center gap-1 rounded-[3px] border border-line px-2" style={{ background: option.theme.background }}>
                    <span className="block h-1.5 w-3/4 rounded-full" style={{ background: option.theme.title }} />
                    <span className="block h-1 w-1/2 rounded-full" style={{ background: option.theme.accent }} />
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-fg">{option.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {kind === 'latex_project' && (
          <Field label="Template">
            <Select value={template} onChange={(event) => setTemplate(event.target.value as 'article' | 'report')}>
              <option value="article">Article — papers and short reports</option>
              <option value="report">Report — longer documents with chapters</option>
            </Select>
          </Field>
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Location</span>
            <button type="button" className="text-xs text-accent-text hover:underline" onClick={() => setChoosingFolder(!choosingFolder)}>
              {choosingFolder ? 'Done' : 'Change…'}
            </button>
          </div>
          {choosingFolder ? (
            <FolderPicker value={parentPath} onChange={setParentPath} className="h-40" />
          ) : (
            <div className="selectable truncate rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-muted">
              Workspace{parentPath ? ` / ${parentPath.split('/').join(' / ')}` : ''}
            </div>
          )}
        </div>
      </form>
    </Modal>
  )
}
