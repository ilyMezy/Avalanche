import { ArrowLeft, FileText, Layers, MoreHorizontal, Palette, Pencil, Play, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Card, Deck } from '@shared/types'
import { openEntry } from '@/app/actions'
import { useAppStore } from '@/app/store'
import { Button, IconButton } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/controls'
import { confirmDialog, promptDialog } from '@/components/ui/dialogs'
import { EmptyState, SectionHeader, Spinner, toast } from '@/components/ui/feedback'
import { ActionMenu, Modal, type MenuEntry } from '@/components/ui/overlays'
import { CardDialog } from './CardDialog'
import { DeckIcon, DeckStyleDialog } from './DeckIcon'
import { deckLabel, ImportDialog } from './ImportDialog'
import { call, errorMessage } from '@/lib/api'
import { invalidate, useData } from '@/lib/useData'
import { cn, formatDue, plural } from '@/lib/utils'
import { StudySession } from './StudySession'

type Route = { view: 'decks' } | { view: 'deck'; deckId: string } | { view: 'study'; deckId: string | null; from: Route }

const deckNameProblem = (value: string): string | null => (value.length > 120 ? 'Deck names are limited to 120 characters.' : null)

async function createDeck(parentId: string | null = null): Promise<Deck | null> {
  const name = await promptDialog({ title: 'New deck', label: 'Deck name', placeholder: 'For example: Physics — Mechanics', confirmLabel: 'Create deck', validate: deckNameProblem })
  if (!name) return null
  try {
    const deck = await call('flashcards.createDeck', { name, parentId })
    invalidate('flashcards')
    return deck
  } catch (error) {
    toast(errorMessage(error), 'error')
    return null
  }
}

async function renameDeck(deck: Deck): Promise<void> {
  const name = await promptDialog({ title: 'Rename deck', label: 'Deck name', initialValue: deck.name, confirmLabel: 'Rename', validate: deckNameProblem })
  if (!name || name === deck.name) return
  await call('flashcards.renameDeck', { id: deck.id, name }).catch((error) => toast(errorMessage(error), 'error'))
  invalidate('flashcards')
}

async function deleteDeck(deck: Deck, mode: 'subtree' | 'reparent' = 'subtree'): Promise<boolean> {
  const confirmed = await confirmDialog({
    title: `Delete “${deck.name}”?`,
    body:
      mode === 'reparent'
        ? `This permanently deletes this deck and its own ${plural(deck.totalCount, 'card')} with their review history. Its subdecks are kept and move up one level. This cannot be undone.`
        : `This permanently deletes the deck${deck.subtreeTotal > deck.totalCount ? ', every subdeck inside it,' : ''} and ${plural(deck.subtreeTotal, 'card')} with their review history. This cannot be undone.`,
    confirmLabel: mode === 'reparent' ? 'Delete this deck only' : 'Delete deck',
    danger: true
  })
  if (!confirmed) return false
  await call('flashcards.deleteDeck', { id: deck.id, mode }).catch((error) => toast(errorMessage(error), 'error'))
  invalidate('flashcards')
  return true
}

const STATE_LABEL: Record<Card['state'], string> = { new: 'New', learning: 'Learning', review: 'Review' }

function DeckDetail({ deckId, onBack, onStudy }: { deckId: string; onBack(): void; onStudy(): void }): ReactNode {
  const decks = useData<Deck[]>(['flashcards'], () => call('flashcards.decks'))
  const cards = useData<Card[]>(['flashcards'], () => call('flashcards.cards', { deckId }), [deckId])
  const [filter, setFilter] = useState('')
  const [dialog, setDialog] = useState<{ card: Card | null } | null>(null)
  const deck = decks.data?.find((candidate) => candidate.id === deckId)

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle ? (cards.data ?? []).filter((card) => card.front.toLowerCase().includes(needle) || card.back.toLowerCase().includes(needle)) : (cards.data ?? [])
  }, [cards.data, filter])

  const removeCard = async (card: Card): Promise<void> => {
    const confirmed = await confirmDialog({
      title: 'Delete this card?',
      body: `“${card.front.slice(0, 120)}” and its review history will be permanently deleted.`,
      confirmLabel: 'Delete card',
      danger: true
    })
    if (!confirmed) return
    await call('flashcards.deleteCard', { id: card.id }).catch((error) => toast(errorMessage(error), 'error'))
    invalidate('flashcards')
  }

  const openSource = async (card: Card): Promise<void> => {
    if (!card.sourceEntryId) return
    const entry = await call('workspace.get', { id: card.sourceEntryId }).catch(() => null)
    if (entry) await openEntry(entry)
    else toast('The source document no longer exists.')
  }

  if (decks.data && !deck) {
    return (
      <EmptyState icon={<Layers size={18} />} title="This deck no longer exists">
        <Button onClick={onBack}>Back to decks</Button>
      </EmptyState>
    )
  }

  const hasDue = (deck?.dueCount ?? 0) + (deck?.newCount ?? 0) > 0

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-6 pt-4 pb-3">
        <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={onBack}>
          <ArrowLeft size={14} />
          All decks
        </Button>
        <SectionHeader
          title={
            deck ? (
              <span className="flex items-center gap-2.5">
                <DeckIcon icon={deck.icon} color={deck.color} size={28} />
                {deck.name}
              </span>
            ) : (
              '…'
            )
          }
          description={deck ? `${plural(deck.totalCount, 'card')} · ${deck.dueCount} due · ${deck.newCount} new` : undefined}
        >
          <div className="relative w-[200px]">
            <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
            <Input aria-label="Filter cards" placeholder="Filter cards" value={filter} onChange={(event) => setFilter(event.target.value)} className="pl-8" />
          </div>
          <Button onClick={() => setDialog({ card: null })}>
            <Plus size={14} />
            Add card
          </Button>
          <Button variant="primary" disabled={(deck?.totalCount ?? 0) === 0} onClick={onStudy} title={hasDue ? undefined : 'Nothing is due: practise every card without changing the schedule'}>
            <Play size={12} fill="currentColor" />
            {hasDue ? 'Study' : 'Practise'}
          </Button>
        </SectionHeader>
      </div>

      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_90px_110px_64px] gap-3 border-b border-line px-9 pb-1.5 text-[11px] font-medium tracking-wide text-subtle uppercase">
        <span>Question</span>
        <span>Answer</span>
        <span>State</span>
        <span>Due</span>
        <span />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2">
        {cards.data === undefined ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : cards.data.length === 0 ? (
          <EmptyState
            icon={<Layers size={18} />}
            title="This deck has no cards yet"
            body="Add cards here, or select text in any document and choose “Create flashcards from selection”."
          >
            <Button variant="primary" onClick={() => setDialog({ card: null })}>
              <Plus size={14} />
              Add card
            </Button>
          </EmptyState>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-xs text-subtle">No cards match your filter.</p>
        ) : (
          visible.map((card) => (
            <div
              key={card.id}
              data-testid="card-row"
              className="group grid min-h-9 cursor-default grid-cols-[minmax(0,1fr)_minmax(0,1fr)_90px_110px_64px] items-center gap-3 rounded-md px-3 py-1.5 text-[13px] hover:bg-hover"
              onDoubleClick={() => setDialog({ card })}
            >
              <span className="truncate text-fg">{card.front}</span>
              <span className="truncate text-muted">{card.back}</span>
              <span>
                <span
                  className={cn(
                    'rounded-full px-2 py-px text-[11px]',
                    card.state === 'new' ? 'bg-accent-soft text-accent-text' : card.state === 'learning' ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'
                  )}
                >
                  {STATE_LABEL[card.state]}
                </span>
              </span>
              <span className="text-xs text-muted">{card.dueDate ? formatDue(card.dueDate, null) : '—'}</span>
              <span className="flex justify-end gap-0.5 text-subtle">
                {card.sourcePathSnapshot && (
                  <IconButton
                    label={card.sourceEntryId ? `Open source: ${card.sourcePathSnapshot}` : `Source missing: ${card.sourcePathSnapshot}`}
                    className="h-6 w-6"
                    disabled={!card.sourceEntryId}
                    onClick={() => void openSource(card)}
                  >
                    <FileText size={13} />
                  </IconButton>
                )}
                <IconButton label="Edit card" className="h-6 w-6" onClick={() => setDialog({ card })}>
                  <Pencil size={13} />
                </IconButton>
                <IconButton label="Delete card" className="h-6 w-6" onClick={() => void removeCard(card)}>
                  <Trash2 size={13} />
                </IconButton>
              </span>
            </div>
          ))
        )}
      </div>
      {dialog && <CardDialog deckId={deckId} card={dialog.card} onClose={() => setDialog(null)} />}
    </div>
  )
}

function DeckList({ onOpen, onStudy }: { onOpen(deckId: string): void; onStudy(deckId: string | null): void }): ReactNode {
  const decks = useData<Deck[]>(['flashcards'], () => call('flashcards.decks'))
  const totalDue = (decks.data ?? []).reduce((sum, deck) => sum + deck.dueCount, 0)
  const [moving, setMoving] = useState<Deck | null>(null)
  const [importing, setImporting] = useState<{ deckId: string | null } | null>(null)
  const [styling, setStyling] = useState<Deck | null>(null)
  const [moveTarget, setMoveTarget] = useState('')
  // A deck can move anywhere except into itself or one of its own subdecks.
  const moveChoices = (deck: Deck): Deck[] => {
    const list = decks.data ?? []
    const start = list.findIndex((candidate) => candidate.id === deck.id)
    let end = start + 1
    while (end < list.length && list[end].depth > deck.depth) end++
    return list.filter((_, index) => index < start || index >= end)
  }
  const confirmMove = async (): Promise<void> => {
    if (!moving) return
    await call('flashcards.moveDeck', { id: moving.id, parentId: moveTarget || null }).catch((error) => toast(errorMessage(error), 'error'))
    invalidate('flashcards')
    setMoving(null)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-8 py-7">
        {importing && (
          <ImportDialog
            decks={decks.data ?? []}
            initialDeckId={importing.deckId}
            onClose={() => setImporting(null)}
            onImported={(deckId) => {
              setImporting(null)
              onOpen(deckId)
            }}
          />
        )}
        {styling && <DeckStyleDialog deck={styling} onClose={() => setStyling(null)} />}
        {moving && (
          <Modal
            open
            onOpenChange={(open) => !open && setMoving(null)}
            title={`Move “${moving.name}”`}
            description="The deck moves with all of its subdecks and cards."
            footer={
              <>
                <Button onClick={() => setMoving(null)}>Cancel</Button>
                <Button variant="primary" disabled={(moving.parentId ?? '') === moveTarget} onClick={() => void confirmMove()}>
                  Move
                </Button>
              </>
            }
          >
            <Field label="New parent deck">
              <Select aria-label="New parent deck" value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)}>
                <option value="">Top level</option>
                {moveChoices(moving).map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deckLabel(deck)}
                  </option>
                ))}
              </Select>
            </Field>
          </Modal>
        )}
        <SectionHeader
          title="Flashcards"
          description={decks.data && decks.data.length > 0 ? (totalDue > 0 ? `${plural(totalDue, 'card')} due for review today.` : 'No reviews are due today.') : undefined}
        >
          <Button onClick={() => setImporting({ deckId: null })}>
            <FileText size={14} />
            Import
          </Button>
          <Button
            onClick={() =>
              void createDeck().then((deck) => {
                if (deck) onOpen(deck.id)
              })
            }
          >
            <Plus size={14} />
            New deck
          </Button>
          <Button variant="primary" disabled={!decks.data?.some((deck) => deck.totalCount > 0)} onClick={() => onStudy(null)}>
            <Play size={12} fill="currentColor" />
            Study all due
          </Button>
        </SectionHeader>

        <div className="mt-6">
          {decks.data === undefined ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : decks.data.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line-strong">
              <EmptyState
                compact
                icon={<Layers size={18} />}
                title="No decks yet"
                body="A deck is a set of question-and-answer cards. Reviews are scheduled with spaced repetition. You can also create cards from text you select in a document."
              >
                <Button
                  variant="primary"
                  onClick={() =>
                    void createDeck().then((deck) => {
                      if (deck) onOpen(deck.id)
                    })
                  }
                >
                  <Plus size={14} />
                  New deck
                </Button>
              </EmptyState>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line">
              {decks.data.map((deck, index) => (
                <div
                  key={deck.id}
                  data-testid="deck-row"
                  data-depth={deck.depth}
                  style={{ paddingLeft: 16 + deck.depth * 26 }}
                  className={cn('group flex h-14 cursor-default items-center gap-4 px-4 transition-colors duration-75 hover:bg-hover', index > 0 && 'border-t border-line')}
                  onClick={() => onOpen(deck.id)}
                >
                  <button
                    type="button"
                    aria-label={`Change the icon of ${deck.name}`}
                    title="Change icon"
                    className="rounded-lg hover:opacity-80"
                    onClick={(event) => {
                      event.stopPropagation()
                      setStyling(deck)
                    }}
                  >
                    <DeckIcon icon={deck.icon} color={deck.color} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-fg">{deck.name}</div>
                    <div className="text-xs text-muted">{plural(deck.subtreeTotal, 'card')}</div>
                  </div>
                  <span className={cn('w-16 text-right text-xs', deck.subtreeDue > 0 ? 'font-medium text-accent-text' : 'text-subtle')}>{deck.subtreeDue} due</span>
                  <span className="w-16 text-right text-xs text-subtle">{deck.subtreeNew} new</span>
                  <Button
                    size="sm"
                    disabled={deck.subtreeTotal === 0}
                    title={deck.subtreeDue + deck.subtreeNew === 0 ? 'Nothing is due: practise every card without changing the schedule' : undefined}
                    onClick={(event) => {
                      event.stopPropagation()
                      onStudy(deck.id)
                    }}
                  >
                    {deck.subtreeDue + deck.subtreeNew === 0 && deck.subtreeTotal > 0 ? 'Practise' : 'Study'}
                  </Button>
                  <span onClick={(event) => event.stopPropagation()}>
                    <ActionMenu
                      align="end"
                      items={[
                        { label: 'Open deck', icon: <Layers size={14} />, onSelect: () => onOpen(deck.id) },
                        { label: 'Rename…', icon: <Pencil size={14} />, onSelect: () => void renameDeck(deck) },
                        { label: 'Change icon…', icon: <Palette size={14} />, onSelect: () => setStyling(deck) },
                        {
                          label: 'New subdeck…',
                          icon: <Plus size={14} />,
                          onSelect: () => void createDeck(deck.id)
                        },
                        { label: 'Move to…', icon: <Layers size={14} />, onSelect: () => (setMoveTarget(deck.parentId ?? ''), setMoving(deck)) },
                        { label: 'Import cards…', icon: <FileText size={14} />, onSelect: () => setImporting({ deckId: deck.id }) },
                        ...(decks.data!.some((other) => other.parentId === deck.id)
                          ? ([{ type: 'separator' }, { label: 'Delete, keep subdecks', icon: <Trash2 size={14} />, danger: true, onSelect: () => void deleteDeck(deck, 'reparent') }] satisfies MenuEntry[])
                          : []),
                        { type: 'separator' },
                        { label: deck.subtreeTotal > deck.totalCount || decks.data!.some((other) => other.parentId === deck.id) ? 'Delete with subdecks' : 'Delete deck', icon: <Trash2 size={14} />, danger: true, onSelect: () => void deleteDeck(deck, 'subtree') }
                      ]}
                    >
                      <IconButton label={`Actions for ${deck.name}`}>
                        <MoreHorizontal size={15} />
                      </IconButton>
                    </ActionMenu>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function FlashcardsView(): ReactNode {
  const [route, setRoute] = useState<Route>({ view: 'decks' })
  const studyRequest = useAppStore((state) => state.studyRequest)
  const decks = useData<Deck[]>(['flashcards'], () => call('flashcards.decks'))

  // Other screens (Home, the command palette) can ask to start studying straight away.
  useEffect(() => {
    if (!studyRequest) return
    setRoute({ view: 'study', deckId: studyRequest.deckId, from: { view: 'decks' } })
    useAppStore.setState({ studyRequest: null })
  }, [studyRequest])

  if (route.view === 'study') {
    const title = route.deckId ? (decks.data?.find((deck) => deck.id === route.deckId)?.name ?? 'Study') : 'All decks'
    return <StudySession deckId={route.deckId} title={title} onExit={() => setRoute(route.from)} />
  }
  if (route.view === 'deck') {
    return (
      <DeckDetail
        deckId={route.deckId}
        onBack={() => setRoute({ view: 'decks' })}
        onStudy={() => setRoute({ view: 'study', deckId: route.deckId, from: route })}
      />
    )
  }
  return <DeckList onOpen={(deckId) => setRoute({ view: 'deck', deckId })} onStudy={(deckId) => setRoute({ view: 'study', deckId, from: route })} />
}
