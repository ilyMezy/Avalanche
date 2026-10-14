import { CircleCheck, FileUp, TriangleAlert } from 'lucide-react'
import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import {
  buildCards,
  decodeText,
  DELIMITERS,
  detectDelimiter,
  detectHeader,
  guessMapping,
  IMPORT_FIELD_LABELS,
  MAX_IMPORT_BYTES,
  parseDelimited,
  readDirectives,
  type Delimiter,
  type ImportField
} from '@shared/domain/csv'
import { stripHtml } from '@shared/domain/html'
import type { Deck, DuplicatePolicy, ImportSummary } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/controls'
import { toast } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlays'
import { call, errorMessage } from '@/lib/api'
import { invalidate } from '@/lib/useData'
import { cn, plural } from '@/lib/utils'

const NEW_DECK = '__new__'
const CHUNK = 1000

interface Loaded {
  name: string
  text: string
  encoding: string
}

const DUPLICATE_HELP: Record<DuplicatePolicy, string> = {
  skip: 'Cards whose question already exists in the deck are left out. Existing cards are not changed.',
  update: 'Cards whose question already exists get the new answer, extra, and tags. Their review history is kept.',
  all: 'Every row becomes a new card, even when the same question already exists.'
}

/** Indented deck names for a select box, so the tree stays readable in a flat list. */
export function deckLabel(deck: Deck): string {
  return `${' '.repeat(deck.depth)}${deck.name}`
}

/**
 * Import flashcards from a CSV or TSV file. Everything is previewed first: the detected
 * delimiter and header can be overridden, columns are mapped by hand, and problems are listed
 * before anything is written. Parsing happens on this computer; no service is involved.
 */
export function ImportDialog({ decks, initialDeckId, onClose, onImported }: { decks: Deck[]; initialDeckId: string | null; onClose(): void; onImported(deckId: string): void }): ReactNode {
  const [file, setFile] = useState<Loaded | null>(null)
  const [delimiter, setDelimiter] = useState<Delimiter>(',')
  const [hasHeader, setHasHeader] = useState(false)
  const [mapping, setMapping] = useState<ImportField[]>([])
  const [deckId, setDeckId] = useState<string>(initialDeckId ?? decks[0]?.id ?? NEW_DECK)
  const [newName, setNewName] = useState('')
  const [newParent, setNewParent] = useState<string>('')
  const [policy, setPolicy] = useState<DuplicatePolicy>('skip')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ summary: ImportSummary; rejected: number; deckId: string } | null>(null)

  const parsed = useMemo(() => (file ? parseDelimited(file.text, delimiter) : null), [file, delimiter])
  const columnCount = useMemo(() => (parsed ? Math.max(0, ...parsed.rows.slice(0, 200).map((row) => row.length)) : 0), [parsed])
  const built = useMemo(() => (parsed && mapping.length ? buildCards(parsed.rows, mapping, hasHeader) : null), [parsed, mapping, hasHeader])

  /** Reads a file's bytes and sets up the first guess at delimiter, header, and mapping. */
  const load = (name: string, bytes: Uint8Array): void => {
    if (bytes.length > MAX_IMPORT_BYTES) return toast('That file is larger than 20 MB, which is more than can be imported at once.', 'error')
    const decoded = decodeText(bytes)
    const directives = readDirectives(decoded.text)
    const guess = directives.separator ?? (/\.tsv$/i.test(name) ? '\t' : detectDelimiter(directives.text))
    const rows = parseDelimited(directives.text, guess, 200).rows
    if (rows.length === 0) return toast('That file has no rows to import.', 'error')
    const header = detectHeader(rows)
    setFile({ name, text: directives.text, encoding: decoded.encoding })
    setDelimiter(guess)
    setHasHeader(header)
    setMapping(guessMapping(header ? rows[0] : null, Math.max(...rows.map((row) => row.length))))
    setResult(null)
  }

  const reparse = (next: Delimiter, header = hasHeader): void => {
    if (!file) return
    const rows = parseDelimited(file.text, next, 200).rows
    setDelimiter(next)
    setMapping(guessMapping(header && rows[0] ? rows[0] : null, Math.max(1, ...rows.map((row) => row.length))))
  }

  const pick = async (): Promise<void> => {
    try {
      const picked = await call('flashcards.importPick')
      if (picked) load(picked.name, picked.bytes)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDragging(false)
    const dropped = event.dataTransfer.files[0]
    if (!dropped) return
    void dropped.arrayBuffer().then(
      (buffer) => load(dropped.name, new Uint8Array(buffer)),
      () => toast('That file could not be read.', 'error')
    )
  }

  const setColumn = (index: number, field: ImportField): void =>
    // Each card field comes from one column: choosing it here releases it elsewhere.
    setMapping((current) => current.map((value, i) => (i === index ? field : field !== 'ignore' && value === field ? 'ignore' : value)))

  const mappedOk = mapping.includes('front') && mapping.includes('back')
  const deckOk = deckId !== NEW_DECK || newName.trim() !== ''
  const targetName = deckId === NEW_DECK ? newName.trim() || 'a new deck' : (decks.find((deck) => deck.id === deckId)?.name ?? '')

  const run = async (): Promise<void> => {
    if (!built || built.cards.length === 0 || !mappedOk || !deckOk || busy) return
    setBusy(true)
    try {
      const target = deckId === NEW_DECK ? (await call('flashcards.createDeck', { name: newName.trim(), parentId: newParent || null })).id : deckId
      const summary: ImportSummary = { imported: 0, skipped: 0, updated: 0 }
      for (let start = 0; start < built.cards.length; start += CHUNK) {
        const part = await call('flashcards.importCards', { deckId: target, duplicates: policy, cards: built.cards.slice(start, start + CHUNK) })
        summary.imported += part.imported
        summary.skipped += part.skipped
        summary.updated += part.updated
      }
      invalidate('flashcards')
      setResult({ summary, rejected: built.rejected.length, deckId: target })
    } catch (error) {
      invalidate('flashcards')
      toast(`The import stopped: ${errorMessage(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const sample = parsed?.rows[hasHeader ? 1 : 0] ?? []
  const header = hasHeader ? parsed?.rows[0] : undefined

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Import flashcards"
      description={result ? undefined : 'From a CSV or TSV file, for example an export from Anki or a spreadsheet.'}
      className="top-[6%] max-h-[88vh] w-[720px]"
      footer={
        result ? (
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => onImported(result.deckId)}>
              Open deck
            </Button>
          </>
        ) : (
          <>
            {built && (
              <span className="mr-auto self-center text-xs text-muted" data-testid="import-summary">
                {plural(built.cards.length, 'card')} ready for “{targetName}”
                {built.rejected.length > 0 && ` · ${plural(built.rejected.length, 'row')} cannot be imported`}
              </span>
            )}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!built || built.cards.length === 0 || !mappedOk || !deckOk || busy} onClick={() => void run()}>
              {busy ? 'Importing…' : built ? `Import ${plural(built.cards.length, 'card')}` : 'Import'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="py-4 text-center" data-testid="import-result">
          <CircleCheck size={28} className="mx-auto mb-3 text-success" />
          <div className="text-[15px] font-medium text-fg">Import finished</div>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            {plural(result.summary.imported, 'card')} added
            {result.summary.updated > 0 && ` · ${result.summary.updated} updated`}
            {result.summary.skipped > 0 && ` · ${plural(result.summary.skipped, 'duplicate')} skipped`}
            {result.rejected > 0 && ` · ${plural(result.rejected, 'row')} left out as incomplete`}
          </p>
        </div>
      ) : !file ? (
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn('flex flex-col items-center rounded-lg border border-dashed px-6 py-10 text-center transition-colors', dragging ? 'border-accent bg-accent-soft' : 'border-line-strong')}
        >
          <FileUp size={24} className="mb-3 text-subtle" />
          <div className="text-[13px] font-medium text-fg">Drop a .csv or .tsv file here</div>
          <p className="mt-1 mb-4 max-w-[420px] text-xs leading-relaxed text-muted">Quoted fields, commas and line breaks inside quotes, tabs, and UTF-8 text are all read correctly.</p>
          <Button variant="primary" onClick={() => void pick()}>
            Choose a file…
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-md bg-surface px-3 py-2 text-xs">
            <span className="min-w-0 truncate text-fg">
              {file.name} <span className="text-subtle">· {file.encoding} · {plural(parsed?.rows.length ?? 0, 'row')}</span>
            </span>
            <button type="button" className="shrink-0 text-accent-text hover:underline" onClick={() => setFile(null)}>
              Choose another file
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Fields are separated by">
              <Select aria-label="Delimiter" value={delimiter} onChange={(event) => reparse(event.target.value as Delimiter)}>
                {DELIMITERS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex cursor-pointer items-center gap-2 self-end pb-1.5 text-[13px] text-fg">
              <input
                type="checkbox"
                checked={hasHeader}
                className="h-4 w-4 accent-[var(--accent)]"
                onChange={(event) => {
                  setHasHeader(event.target.checked)
                  reparse(delimiter, event.target.checked)
                }}
              />
              The first row contains column names
            </label>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted">Columns</div>
            <div className="overflow-hidden rounded-md border border-line">
              {Array.from({ length: columnCount }, (_, index) => (
                <div key={index} className={cn('flex items-center gap-3 px-3 py-1.5', index > 0 && 'border-t border-line')}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-fg">{header?.[index]?.trim() || `Column ${index + 1}`}</div>
                    <div className="truncate text-[11px] text-subtle">{stripHtml(sample[index] ?? '').slice(0, 90) || 'empty'}</div>
                  </div>
                  <Select aria-label={`Use column ${index + 1} as`} className="w-[190px]" value={mapping[index] ?? 'ignore'} onChange={(event) => setColumn(index, event.target.value as ImportField)}>
                    {(Object.keys(IMPORT_FIELD_LABELS) as ImportField[]).map((field) => (
                      <option key={field} value={field}>
                        {IMPORT_FIELD_LABELS[field]}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            {!mappedOk && <p className="mt-1.5 text-xs text-danger">Choose one column for the front and one for the back.</p>}
          </div>

          {built && built.cards.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted">Preview</div>
              <div className="overflow-hidden rounded-md border border-line text-xs" data-testid="import-preview">
                {built.cards.slice(0, 4).map((card, index) => (
                  <div key={index} className={cn('grid grid-cols-2 gap-3 px-3 py-1.5', index > 0 && 'border-t border-line')}>
                    <span className="truncate text-fg">{stripHtml(card.front)}</span>
                    <span className="truncate text-muted">
                      {stripHtml(card.back)}
                      {card.tags && <span className="ml-2 text-subtle">#{card.tags.split(' ').join(' #')}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {((parsed?.warnings.length ?? 0) > 0 || parsed?.truncated || (built?.rejected.length ?? 0) > 0) && (
            <div className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-fg" role="alert" data-testid="import-warnings">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <TriangleAlert size={13} className="text-warning" />
                Check before importing
              </div>
              {parsed?.truncated && <div>Only the first 50,000 rows of this file were read.</div>}
              {parsed?.warnings.map((warning, index) => (
                <div key={`w${index}`}>
                  Line {warning.line}: {warning.message}
                </div>
              ))}
              {built?.rejected.slice(0, 4).map((row) => (
                <div key={`r${row.record}`}>
                  Row {row.record}: {row.reason}
                </div>
              ))}
              {(built?.rejected.length ?? 0) > 4 && <div>…and {built!.rejected.length - 4} more rows like these.</div>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Import into">
              <Select aria-label="Target deck" value={deckId} onChange={(event) => setDeckId(event.target.value)}>
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deckLabel(deck)}
                  </option>
                ))}
                <option value={NEW_DECK}>New deck…</option>
              </Select>
            </Field>
            <Field label="If a card already exists">
              <Select aria-label="Duplicate handling" value={policy} onChange={(event) => setPolicy(event.target.value as DuplicatePolicy)}>
                <option value="skip">Skip duplicates</option>
                <option value="update">Update existing cards</option>
                <option value="all">Import everything</option>
              </Select>
            </Field>
            {deckId === NEW_DECK && (
              <>
                <Field label="New deck name">
                  <Input aria-label="New deck name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Deck name" />
                </Field>
                <Field label="Inside">
                  <Select aria-label="Parent deck" value={newParent} onChange={(event) => setNewParent(event.target.value)}>
                    <option value="">Top level</option>
                    {decks.map((deck) => (
                      <option key={deck.id} value={deck.id}>
                        {deckLabel(deck)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
          </div>
          <p className="text-xs leading-relaxed text-subtle">{DUPLICATE_HELP[policy]} Two cards match when their questions are the same, ignoring letter case, spacing, and formatting.</p>
        </div>
      )}
    </Modal>
  )
}
