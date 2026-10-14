import { useState, type ReactNode } from 'react'
import type { Card, Deck } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Field, Select, Textarea } from '@/components/ui/controls'
import { toast } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlays'
import { call, errorMessage } from '@/lib/api'
import { invalidate, useData } from '@/lib/useData'
import { deckLabel } from './ImportDialog'

/**
 * Creates a card, or edits one: its question, its answer, and the deck it is in. Used from the
 * card list and from a study session. Editing never resets the review schedule.
 */
export function CardDialog({
  deckId,
  card,
  onClose,
  onSaved
}: {
  deckId: string
  card: Pick<Card, 'id' | 'front' | 'back'> | null
  onClose(): void
  /** Called after an existing card was saved, with its new text. */
  onSaved?(front: string, back: string): void
}): ReactNode {
  const [front, setFront] = useState(card?.front ?? '')
  const [back, setBack] = useState(card?.back ?? '')
  const [busy, setBusy] = useState(false)
  const valid = front.trim() !== '' && back.trim() !== ''
  const decks = useData<Deck[]>(['flashcards'], () => call('flashcards.decks'))
  // Changing the deck moves the card; its schedule and review history go with it.
  const [targetDeck, setTargetDeck] = useState(deckId)

  const save = async (keepOpen: boolean): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    try {
      if (card) {
        await call('flashcards.updateCard', { id: card.id, front, back })
        if (targetDeck !== deckId) await call('flashcards.moveCards', { cardIds: [card.id], deckId: targetDeck })
        onSaved?.(front.trim(), back.trim())
      } else {
        await call('flashcards.createCards', { deckId, cards: [{ front, back }] })
      }
      invalidate('flashcards')
      if (keepOpen) {
        setFront('')
        setBack('')
      } else {
        onClose()
      }
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={card ? 'Edit card' : 'New card'}
      description={card ? 'Editing the text does not reset the review schedule.' : undefined}
      className="w-[520px]"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {!card && (
            <Button disabled={!valid || busy} onClick={() => void save(true)}>
              Save and add another
            </Button>
          )}
          <Button variant="primary" disabled={!valid || busy} onClick={() => void save(false)}>
            {card ? 'Save changes' : 'Save card'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {card && (decks.data?.length ?? 0) > 1 && (
          <Field label="Deck">
            <Select aria-label="Deck" value={targetDeck} onChange={(event) => setTargetDeck(event.target.value)}>
              {decks.data!.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deckLabel(deck)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Question (front)">
          <Textarea autoFocus rows={3} value={front} onChange={(event) => setFront(event.target.value)} aria-label="Question" />
        </Field>
        <Field label="Answer (back)">
          <Textarea rows={4} value={back} onChange={(event) => setBack(event.target.value)} aria-label="Answer" />
        </Field>
      </div>
    </Modal>
  )
}
