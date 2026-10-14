import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { duplicateKey, type ImportCard } from '@shared/domain/csv'
import { AppError } from '@shared/errors'
import { isSameDayRepeat, schedule, studyDate } from '@shared/domain/sm2'
import { uuidv7 } from '@shared/domain/uuid'
import type { Card, CardState, Deck, DuplicatePolicy, FlashcardSummary, ImportSummary, Rating, StudyCard } from '@shared/types'
import { cardReviews, cards, decks, entries } from '../infrastructure/db/schema'
import type { AppContext } from './context'

type CardRow = typeof cards.$inferSelect
type DeckRow = typeof decks.$inferSelect

function toCard(row: CardRow): Card {
  return { ...row, state: row.state as CardState }
}

const byName = (a: DeckRow, b: DeckRow): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })

/**
 * Flashcards. Decks form a real tree through `deck.parent_id`: a subdeck is a deck whose
 * parent is another deck, not a naming convention. Cards belong to exactly one deck.
 */
export class FlashcardsService {
  constructor(private readonly ctx: AppContext) {}

  private today(): string {
    return studyDate(new Date(this.ctx.now()))
  }

  private allDecks(): DeckRow[] {
    return this.ctx.db.select().from(decks).all()
  }

  private deckRow(id: string): DeckRow {
    const row = this.ctx.db.select().from(decks).where(eq(decks.id, id)).get()
    if (!row) throw new AppError('NOT_FOUND', 'That deck no longer exists.')
    return row
  }

  private cardRow(id: string): CardRow {
    const row = this.ctx.db.select().from(cards).where(eq(cards.id, id)).get()
    if (!row) throw new AppError('NOT_FOUND', 'That card no longer exists.')
    return row
  }

  /** The ids of a deck and every deck beneath it. */
  private subtreeIds(rootId: string, rows: DeckRow[] = this.allDecks()): string[] {
    const children = new Map<string | null, DeckRow[]>()
    for (const row of rows) {
      const list = children.get(row.parentId) ?? []
      list.push(row)
      children.set(row.parentId, list)
    }
    const ids: string[] = []
    const visit = (id: string): void => {
      ids.push(id)
      for (const child of children.get(id) ?? []) if (!ids.includes(child.id)) visit(child.id)
    }
    visit(rootId)
    return ids
  }

  /**
   * Every deck in tree order (parents before their children, siblings by name), each with its
   * depth, its own card counts, and counts for its whole subtree.
   */
  listDecks(): Deck[] {
    const today = this.today()
    const rows = this.allDecks()
    const counts = new Map(
      this.ctx.db
        .select({
          deckId: cards.deckId,
          total: sql<number>`count(*)`,
          fresh: sql<number>`coalesce(sum(${cards.state} = 'new'), 0)`,
          due: sql<number>`coalesce(sum(${cards.state} != 'new' AND ${cards.dueDate} <= ${today}), 0)`
        })
        .from(cards)
        .groupBy(cards.deckId)
        .all()
        .map((row) => [row.deckId, row])
    )
    const known = new Set(rows.map((row) => row.id))
    const children = new Map<string | null, DeckRow[]>()
    for (const row of rows) {
      // A deck whose parent has vanished is shown at the top level rather than hidden.
      const parent = row.parentId && known.has(row.parentId) ? row.parentId : null
      const list = children.get(parent) ?? []
      list.push(row)
      children.set(parent, list)
    }
    const out: Deck[] = []
    const visit = (row: DeckRow, depth: number): Deck => {
      const own = counts.get(row.id)
      const deck: Deck = {
        ...row,
        parentId: row.parentId && known.has(row.parentId) ? row.parentId : null,
        depth,
        totalCount: own?.total ?? 0,
        newCount: own?.fresh ?? 0,
        dueCount: own?.due ?? 0,
        subtreeTotal: own?.total ?? 0,
        subtreeNew: own?.fresh ?? 0,
        subtreeDue: own?.due ?? 0
      }
      out.push(deck)
      for (const child of (children.get(row.id) ?? []).sort(byName)) {
        const below = visit(child, depth + 1)
        deck.subtreeTotal += below.subtreeTotal
        deck.subtreeNew += below.subtreeNew
        deck.subtreeDue += below.subtreeDue
      }
      return deck
    }
    for (const root of (children.get(null) ?? []).sort(byName)) visit(root, 0)
    return out
  }

  private deckById(id: string): Deck {
    const deck = this.listDecks().find((candidate) => candidate.id === id)
    if (!deck) throw new AppError('NOT_FOUND', 'That deck no longer exists.')
    return deck
  }

  createDeck(name: string, parentId: string | null = null): Deck {
    if (parentId) this.deckRow(parentId)
    const now = this.ctx.now()
    const id = uuidv7()
    this.ctx.db.insert(decks).values({ id, parentId, name, createdAt: now, updatedAt: now }).run()
    return this.deckById(id)
  }

  setDeckStyle(id: string, icon: string, color: string): Deck {
    this.deckRow(id)
    this.ctx.db.update(decks).set({ icon, color, updatedAt: this.ctx.now() }).where(eq(decks.id, id)).run()
    return this.deckById(id)
  }

  renameDeck(id: string, name: string): Deck {
    this.deckRow(id)
    this.ctx.db.update(decks).set({ name, updatedAt: this.ctx.now() }).where(eq(decks.id, id)).run()
    return this.deckById(id)
  }

  /** Moves a deck (with its subdecks and cards) under another deck, or to the top level. */
  moveDeck(id: string, parentId: string | null): Deck {
    this.deckRow(id)
    if (parentId) {
      this.deckRow(parentId)
      if (this.subtreeIds(id).includes(parentId)) throw new AppError('INVALID_INPUT', 'A deck cannot be moved into itself or one of its own subdecks.')
    }
    this.ctx.db.update(decks).set({ parentId, updatedAt: this.ctx.now() }).where(eq(decks.id, id)).run()
    return this.deckById(id)
  }

  /**
   * Deletes a deck and its cards. `subtree` also deletes every subdeck beneath it; `reparent`
   * keeps the subdecks and moves them up to the deleted deck's parent.
   */
  deleteDeck(id: string, mode: 'subtree' | 'reparent' = 'subtree'): void {
    const row = this.ctx.db.select().from(decks).where(eq(decks.id, id)).get()
    if (!row) return
    this.ctx.db.transaction((tx) => {
      if (mode === 'reparent') {
        tx.update(decks).set({ parentId: row.parentId, updatedAt: this.ctx.now() }).where(eq(decks.parentId, id)).run()
        tx.delete(decks).where(eq(decks.id, id)).run()
      } else {
        // Cards and their review history go with each deck through ON DELETE CASCADE.
        tx.delete(decks).where(inArray(decks.id, this.subtreeIds(id))).run()
      }
    })
  }

  listCards(deckId: string): Card[] {
    return this.ctx.db.select().from(cards).where(eq(cards.deckId, deckId)).orderBy(asc(cards.position)).all().map(toCard)
  }

  private nextPosition(deckId: string): number {
    const last = this.ctx.db.select({ max: sql<number>`coalesce(max(${cards.position}), 0)` }).from(cards).where(eq(cards.deckId, deckId)).get()
    return (last?.max ?? 0) + 1
  }

  createCards(
    deckId: string,
    drafts: { front: string; back: string; extra?: string; tags?: string }[],
    sourceEntryId: string | null = null,
    sourceExcerpt: string | null = null
  ): Card[] {
    this.deckRow(deckId)
    const now = this.ctx.now()
    const source = sourceEntryId ? this.ctx.db.select().from(entries).where(eq(entries.id, sourceEntryId)).get() : undefined
    let position = this.nextPosition(deckId)
    const ids: string[] = []
    this.ctx.db.transaction((tx) => {
      for (const draft of drafts) {
        const id = uuidv7()
        ids.push(id)
        tx.insert(cards)
          .values({
            id,
            deckId,
            position: position++,
            front: draft.front,
            back: draft.back,
            extra: draft.extra ?? '',
            tags: draft.tags ?? '',
            sourceEntryId: source?.id ?? null,
            sourcePathSnapshot: source?.relPath ?? null,
            sourceExcerpt: source ? sourceExcerpt : null,
            createdAt: now,
            updatedAt: now
          })
          .run()
      }
    })
    return ids.map((id) => toCard(this.cardRow(id)))
  }

  /**
   * Imports cards into a deck. Duplicates are cards whose question matches an existing card in
   * the same deck after removing markup, collapsing whitespace, and ignoring case
   * (`duplicateKey`). The policy decides what happens to them:
   *   all    – import everything, duplicates included;
   *   skip   – leave existing cards alone and do not add the duplicate;
   *   update – replace the existing card's answer, extra, and tags. Its schedule and review
   *            history are never touched.
   * With skip and update, a question repeated inside the file is imported once.
   */
  importCards(deckId: string, incoming: ImportCard[], policy: DuplicatePolicy): ImportSummary {
    this.deckRow(deckId)
    const now = this.ctx.now()
    const existing = new Map<string, CardRow>()
    if (policy !== 'all') {
      for (const row of this.ctx.db.select().from(cards).where(eq(cards.deckId, deckId)).all()) {
        const key = duplicateKey(row.front)
        if (!existing.has(key)) existing.set(key, row)
      }
    }
    const summary: ImportSummary = { imported: 0, skipped: 0, updated: 0 }
    const seen = new Set<string>()
    let position = this.nextPosition(deckId)
    this.ctx.db.transaction((tx) => {
      for (const card of incoming) {
        const key = duplicateKey(card.front)
        if (policy !== 'all') {
          if (seen.has(key)) {
            summary.skipped++
            continue
          }
          seen.add(key)
          const match = existing.get(key)
          if (match) {
            const changed = match.back !== card.back || match.extra !== card.extra || match.tags !== card.tags
            if (policy === 'update' && changed) {
              tx.update(cards).set({ back: card.back, extra: card.extra, tags: card.tags, updatedAt: now }).where(eq(cards.id, match.id)).run()
              summary.updated++
            } else {
              summary.skipped++
            }
            continue
          }
        }
        tx.insert(cards)
          .values({ id: uuidv7(), deckId, position: position++, front: card.front, back: card.back, extra: card.extra, tags: card.tags, createdAt: now, updatedAt: now })
          .run()
        summary.imported++
      }
    })
    return summary
  }

  /** Editing a card's text does not reset its schedule. */
  updateCard(id: string, front: string, back: string, extra?: string, tags?: string): Card {
    this.cardRow(id)
    this.ctx.db
      .update(cards)
      .set({ front, back, ...(extra !== undefined ? { extra } : {}), ...(tags !== undefined ? { tags } : {}), updatedAt: this.ctx.now() })
      .where(eq(cards.id, id))
      .run()
    return toCard(this.cardRow(id))
  }

  deleteCard(id: string): void {
    this.ctx.db.delete(cards).where(eq(cards.id, id)).run()
  }

  /** Moves cards to another deck, keeping each card's schedule and review history. */
  moveCards(cardIds: string[], deckId: string): void {
    this.deckRow(deckId)
    let position = this.nextPosition(deckId)
    const now = this.ctx.now()
    this.ctx.db.transaction((tx) => {
      for (const id of cardIds) {
        tx.update(cards).set({ deckId, position: position++, updatedAt: now }).where(eq(cards.id, id)).run()
      }
    })
  }

  /** How many new cards may still be introduced today in a deck (per-deck daily limit). */
  private newAllowance(deck: DeckRow, today: string): number {
    const introduced = this.ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(cardReviews)
      .innerJoin(cards, eq(cards.id, cardReviews.cardId))
      .where(and(eq(cards.deckId, deck.id), eq(cardReviews.studyDate, today), eq(cardReviews.wasNew, true)))
      .get()
    return Math.max(0, deck.newPerDay - (introduced?.count ?? 0))
  }

  /**
   * Cards to study: due reviews first (oldest due date first), then new cards in deck order.
   * `deckId` null means every deck. With `includeSubdecks`, a deck's queue also covers all of
   * its subdecks; without it, only the deck's own cards.
   */
  studyQueue(deckId: string | null, includeSubdecks = true, mode: 'due' | 'all' = 'due'): StudyCard[] {
    const today = this.today()
    const all = this.allDecks()
    let deckRows: DeckRow[]
    if (deckId === null) deckRows = all
    else {
      this.deckRow(deckId)
      const wanted = new Set(includeSubdecks ? this.subtreeIds(deckId, all) : [deckId])
      deckRows = all.filter((row) => wanted.has(row.id))
    }
    deckRows.sort(byName)
    const due: StudyCard[] = []
    const fresh: StudyCard[] = []
    for (const deck of deckRows) {
      const rows = this.ctx.db.select().from(cards).where(eq(cards.deckId, deck.id)).orderBy(asc(cards.position)).all()
      if (mode === 'all') {
        // Practice: every card, in deck order, whatever its schedule says.
        for (const row of rows) due.push({ ...toCard(row), deckName: deck.name })
        continue
      }
      const allowance = this.newAllowance(deck, today)
      let taken = 0
      for (const row of rows) {
        if (row.state === 'new') {
          if (taken < allowance) {
            fresh.push({ ...toCard(row), deckName: deck.name })
            taken++
          }
        } else if (row.dueDate && row.dueDate <= today) {
          due.push({ ...toCard(row), deckName: deck.name })
        }
      }
    }
    if (mode === 'due') due.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
    return [...due, ...fresh]
  }

  /** Applies a rating. The new schedule and the review-log row are persisted immediately. */
  rate(cardId: string, rating: Rating): Card {
    const row = this.cardRow(cardId)
    const today = this.today()
    const before = toCard(row)
    const repeat = isSameDayRepeat(before, today)
    const after = schedule(before, rating, today)
    const now = this.ctx.now()
    this.ctx.db.transaction((tx) => {
      tx.update(cards)
        .set({
          state: after.state,
          repetitions: after.repetitions,
          intervalDays: after.intervalDays,
          easeFactor: after.easeFactor,
          lapses: after.lapses,
          dueDate: after.dueDate,
          lastReviewDate: after.lastReviewDate,
          updatedAt: now
        })
        .where(eq(cards.id, cardId))
        .run()
      tx.insert(cardReviews)
        .values({
          id: uuidv7(),
          cardId,
          reviewedAt: now,
          rating,
          prevIntervalDays: before.intervalDays,
          newIntervalDays: after.intervalDays,
          prevEaseFactor: before.easeFactor,
          newEaseFactor: after.easeFactor,
          wasNew: before.state === 'new' && !repeat,
          studyDate: today
        })
        .run()
    })
    return toCard(this.cardRow(cardId))
  }

  summary(): FlashcardSummary {
    const queue = this.studyQueue(null)
    return {
      dueCount: queue.filter((card) => card.state !== 'new').length,
      newAvailable: queue.filter((card) => card.state === 'new').length,
      deckCount: this.allDecks().length
    }
  }
}
