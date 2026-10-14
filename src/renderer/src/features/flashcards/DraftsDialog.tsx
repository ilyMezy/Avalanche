import { ArrowLeftRight, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { CARD_FORMAT_HELP, extractFlashcards, RULE_LABELS, type DraftCard } from '@shared/domain/extraction'
import type { Deck } from '@shared/types'
import { useAppStore } from '@/app/store'
import { Button, IconButton } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/controls'
import { toast } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlays'
import { call, errorMessage } from '@/lib/api'
import { invalidate } from '@/lib/useData'
import { plural } from '@/lib/utils'

const NEW_DECK = '__new__'

/**
 * Review dialog for flashcards drafted from selected text. The drafts come from local,
 * deterministic rules (no AI, no network). Nothing is saved until the user confirms.
 */
export function DraftsDialog(): ReactNode {
  const request = useAppStore((state) => state.draftRequest)
  const [drafts, setDrafts] = useState<(DraftCard & { key: number })[]>([])
  const [decks, setDecks] = useState<Deck[]>([])
  const [deckId, setDeckId] = useState<string>(NEW_DECK)
  const [newDeckName, setNewDeckName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!request) return
    setDrafts(extractFlashcards(request.text).map((draft, index) => ({ ...draft, key: index })))
    setNewDeckName('')
    setBusy(false)
    void call('flashcards.decks').then((list) => {
      setDecks(list)
      setDeckId(list[0]?.id ?? NEW_DECK)
    })
  }, [request])

  if (!request) return null
  const close = (): void => useAppStore.setState({ draftRequest: null })
  const update = (key: number, patch: Partial<DraftCard>): void =>
    setDrafts((list) => list.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))

  const complete = drafts.filter((draft) => draft.front.trim() && draft.back.trim())
  const deckReady = deckId !== NEW_DECK || newDeckName.trim() !== ''

  const save = async (): Promise<void> => {
    if (complete.length === 0 || !deckReady || busy) return
    setBusy(true)
    try {
      const target = deckId === NEW_DECK ? (await call('flashcards.createDeck', { name: newDeckName.trim() })).id : deckId
      await call('flashcards.createCards', {
        deckId: target,
        cards: complete.map((draft) => ({ front: draft.front, back: draft.back })),
        sourceEntryId: request.sourceEntryId,
        sourceExcerpt: request.text.slice(0, 8000)
      })
      invalidate('flashcards')
      toast(`Saved ${plural(complete.length, 'card')}.`)
      close()
    } catch (error) {
      toast(errorMessage(error), 'error')
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && close()}
      title="Create flashcards from selection"
      description="These drafts were produced by simple, English-oriented rules on this computer. Edit them as needed; nothing is saved until you confirm."
      className="w-[640px]"
      footer={
        <>
          <span className="mr-auto self-center text-xs text-subtle">
            {complete.length} of {drafts.length} ready
            {complete.length < drafts.length ? ' — cards need both a question and an answer' : ''}
          </span>
          <Button onClick={close}>Discard drafts</Button>
          <Button variant="primary" disabled={complete.length === 0 || !deckReady || busy} onClick={() => void save()}>
            Save {plural(complete.length, 'card')}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-end gap-2">
        <label className="flex-1">
          <span className="mb-1.5 block text-xs font-medium text-muted">Deck</span>
          <Select value={deckId} onChange={(event) => setDeckId(event.target.value)} aria-label="Destination deck">
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.name}
              </option>
            ))}
            <option value={NEW_DECK}>New deck…</option>
          </Select>
        </label>
        {deckId === NEW_DECK && (
          <label className="flex-1">
            <span className="mb-1.5 block text-xs font-medium text-muted">New deck name</span>
            <Input value={newDeckName} onChange={(event) => setNewDeckName(event.target.value)} placeholder="Deck name" aria-label="New deck name" />
          </label>
        )}
      </div>

      <details className="mb-3 rounded-lg border border-line bg-raised px-3 py-2 text-xs text-muted" data-testid="card-format-help">
        <summary className="cursor-pointer font-medium text-fg">Card format: write lines like these and they always become cards</summary>
        <table className="mt-2 w-full">
          <tbody>
            {CARD_FORMAT_HELP.map((row) => (
              <tr key={row.syntax}>
                <td className="selectable py-0.5 pr-3 font-mono text-[11px] text-fg">{row.syntax}</td>
                <td className="py-0.5">{row.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1.5 text-subtle">The separators need a space on each side. Lines that do not use the format are still read with the general rules.</p>
      </details>

      <div className="space-y-2">
        {drafts.map((draft) => (
          <div key={draft.key} className="rounded-lg border border-line bg-raised p-2.5" data-testid="draft-card">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] text-subtle">Rule: {RULE_LABELS[draft.rule]}</span>
              <span className="flex gap-0.5">
                <IconButton label="Swap question and answer" className="h-6 w-6" onClick={() => update(draft.key, { front: draft.back, back: draft.front })}>
                  <ArrowLeftRight size={13} />
                </IconButton>
                <IconButton label="Remove this draft" className="h-6 w-6" onClick={() => setDrafts((list) => list.filter((item) => item.key !== draft.key))}>
                  <Trash2 size={13} />
                </IconButton>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Textarea rows={3} aria-label="Question" placeholder="Question" value={draft.front} onChange={(event) => update(draft.key, { front: event.target.value })} />
              <Textarea rows={3} aria-label="Answer" placeholder="Answer" value={draft.back} onChange={(event) => update(draft.key, { back: event.target.value })} />
            </div>
          </div>
        ))}
        {drafts.length === 0 && <p className="py-6 text-center text-xs text-subtle">All drafts were removed.</p>}
      </div>
    </Modal>
  )
}
