import { ArrowLeft, CheckCircle2, Pencil, RotateCcw } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { looksLikeHtml, sanitizeBasicHtml } from '@shared/domain/html'
import type { Rating, StudyCard } from '@shared/types'
import { Button } from '@/components/ui/button'
import { EASE_OUT, EmptyState, Kbd, Spinner, toast } from '@/components/ui/feedback'
import { call, errorMessage } from '@/lib/api'
import { invalidate } from '@/lib/useData'
import { cn, plural } from '@/lib/utils'
import { CardDialog } from './CardDialog'

const RATINGS: { rating: Rating; label: string; hint: string; key: string; tone: string }[] = [
  { rating: 'again', label: 'Again', hint: 'Forgot', key: '1', tone: 'hover:border-danger hover:text-danger' },
  { rating: 'hard', label: 'Hard', hint: 'Struggled', key: '2', tone: 'hover:border-warning hover:text-warning' },
  { rating: 'good', label: 'Good', hint: 'Recalled', key: '3', tone: 'hover:border-success hover:text-success' },
  { rating: 'easy', label: 'Easy', hint: 'Instant', key: '4', tone: 'hover:border-accent hover:text-accent-text' }
]

/**
 * Card text. Imported cards may contain basic markup; it is shown through the allowlist
 * sanitizer, so only plain formatting tags without attributes ever reach the page.
 */
function CardText({ text }: { text: string }): ReactNode {
  if (!looksLikeHtml(text)) return <>{text}</>
  return <div className="card-html whitespace-normal" dangerouslySetInnerHTML={{ __html: sanitizeBasicHtml(text) }} />
}

const STATE_LABEL ={ new: 'New card', learning: 'Learning', review: 'Review' } as const

/**
 * A focused study session: flip the card (Space), then rate recall (1–4). Every rating is
 * saved immediately, so closing the app mid-session loses nothing.
 *
 * The card turns over in 3D to reveal the answer. With "reduce motion" enabled in Windows it
 * crossfades instead.
 *
 * When nothing is due, or after a session, the deck can be gone through again as practice:
 * every card is shown, and the ratings only decide what comes back in this run. Practice never
 * changes a card's schedule or its review history.
 */
export function StudySession({ deckId, title, onExit }: { deckId: string | null; title: string; onExit(): void }): ReactNode {
  const [queue, setQueue] = useState<StudyCard[] | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [counts, setCounts] = useState<Record<Rating, number>>({ again: 0, hard: 0, good: 0, easy: 0 })
  const [reviewed, setReviewed] = useState(0)
  const [practice, setPractice] = useState(false)
  const [editing, setEditing] = useState(false)
  const total = useRef(0)
  const done = useRef(new Set<string>())
  const reduceMotion = useReducedMotion()

  const load = useCallback(
    (mode: 'due' | 'all') => {
      setQueue(null)
      call('flashcards.studyQueue', { deckId, mode }).then(
        (cards) => {
          total.current = cards.length
          done.current = new Set()
          setCounts({ again: 0, hard: 0, good: 0, easy: 0 })
          setReviewed(0)
          setFlipped(false)
          setPractice(mode === 'all')
          setQueue(cards)
        },
        (error: unknown) => {
          toast(errorMessage(error), 'error')
          setQueue([])
        }
      )
    },
    [deckId]
  )

  useEffect(() => load('due'), [load])

  const current = queue?.[0]

  const rate = useCallback(
    async (rating: Rating) => {
      if (!current || !flipped || busy) return
      setBusy(true)
      try {
        // In practice the rating is not recorded: the schedule and the review log stay as they are.
        const updated = practice ? {} : await call('flashcards.rate', { cardId: current.id, rating })
        setCounts((previous) => ({ ...previous, [rating]: previous[rating] + 1 }))
        setReviewed((value) => value + 1)
        if (rating !== 'again') done.current.add(current.id)
        // A card rated Again comes back later in the same session until it is recalled.
        setQueue((previous) => {
          const rest = (previous ?? []).slice(1)
          return rating === 'again' ? [...rest, { ...current, ...updated }] : rest
        })
        setFlipped(false)
        if (!practice) invalidate('flashcards')
      } catch (error) {
        toast(errorMessage(error), 'error')
      } finally {
        setBusy(false)
      }
    },
    [current, flipped, busy, practice]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey) return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      // While the edit dialog is open the keys belong to it.
      if (editing) return
      if (event.code === 'Space') {
        event.preventDefault()
        setFlipped(true)
      }
      const match = RATINGS.find((option) => option.key === event.key)
      if (match) void rate(match.rating)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rate, editing])

  const progress = total.current > 0 ? done.current.size / total.current : 0

  const header = (
    <div className="shrink-0">
      <div className="flex h-11 items-center gap-3 px-4">
        <Button variant="ghost" size="sm" onClick={onExit}>
          <ArrowLeft size={14} />
          End session
        </Button>
        <span className="truncate text-[13px] font-medium">{title}</span>
        {practice && (
          <span className="rounded-full bg-accent-soft px-2 py-px text-[11px] text-accent-text" data-testid="practice-badge" title="Practice does not change the review schedule">
            Practice
          </span>
        )}
        <span className="flex-1" />
        {queue && queue.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={13} />
            Edit card
          </Button>
        )}
        {queue && queue.length > 0 && (
          <span className="text-xs text-muted tabular-nums" data-testid="study-remaining">
            {queue.length} left
          </span>
        )}
      </div>
      {/* Progress through the session: cards recalled out of cards queued. */}
      <div className="h-px bg-line" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <motion.div className="h-px origin-left bg-accent" initial={false} animate={{ scaleX: progress }} transition={{ duration: 0.3, ease: EASE_OUT }} />
      </div>
    </div>
  )

  if (queue === null) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </div>
    )
  }

  if (!current) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <EmptyState
          icon={<CheckCircle2 size={18} />}
          title={reviewed > 0 ? (practice ? 'Practice complete' : 'Session complete') : total.current === 0 && practice ? 'There are no cards here yet' : 'Nothing is due right now'}
          body={
            reviewed > 0
              ? `${plural(reviewed, 'review')}: Again ${counts.again} · Hard ${counts.hard} · Good ${counts.good} · Easy ${counts.easy}${practice ? '. Practice did not change the schedule.' : ''}`
              : 'Cards come back when their next review date arrives. You can still go through every card as practice; that does not change the schedule.'
          }
        >
          {!(practice && total.current === 0) && (
            <Button variant={reviewed > 0 ? 'secondary' : 'primary'} onClick={() => load('all')}>
              <RotateCcw size={13} />
              {practice ? 'Practise again' : 'Practise all cards'}
            </Button>
          )}
          <Button variant={reviewed > 0 ? 'primary' : 'secondary'} onClick={onExit}>
            Back to decks
          </Button>
        </EmptyState>
      </div>
    )
  }

  const editDialog = editing && (
    <CardDialog
      deckId={current.deckId}
      card={current}
      onClose={() => setEditing(false)}
      onSaved={(front, back) => setQueue((previous) => (previous ?? []).map((card) => (card.id === current.id ? { ...card, front, back } : card)))}
    />
  )
  const face = 'flip-face flex min-h-[220px] flex-col rounded-xl border border-line-strong bg-surface shadow-pop'

  return (
    <div className="flex h-full flex-col">
      {header}
      {editDialog}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-7 overflow-y-auto px-6 py-8">
        {/* Each new card rises into place; the key restarts the entrance per card. */}
        <motion.div
          key={current.id + ':' + reviewed}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: EASE_OUT }}
          className="w-full max-w-[620px]"
        >
          <div className="mb-2 flex justify-between text-[11px] text-subtle">
            <span>{current.deckName}</span>
            <span>{STATE_LABEL[current.state]}</span>
          </div>

          <div className="flip-scene" data-testid="study-card">
            <motion.div
              className="grid"
              style={{ transformStyle: 'preserve-3d' }}
              initial={false}
              animate={reduceMotion ? { rotateX: 0 } : { rotateX: flipped ? 180 : 0 }}
              transition={{ duration: 0.42, ease: [0.3, 0.1, 0.2, 1] }}
            >
              <motion.div className={face} initial={false} animate={reduceMotion ? { opacity: flipped ? 0 : 1 } : { opacity: 1 }} aria-hidden={flipped}>
                <div className="selectable flex flex-1 items-center justify-center px-9 py-9 text-center text-[19px] leading-relaxed whitespace-pre-wrap text-fg"><CardText text={current.front} /></div>
              </motion.div>

              <motion.div
                className={face}
                style={{ rotateX: reduceMotion ? 0 : 180, visibility: flipped ? 'visible' : 'hidden' }}
                initial={false}
                animate={reduceMotion ? { opacity: flipped ? 1 : 0 } : { opacity: 1 }}
                aria-hidden={!flipped}
              >
                <div className="selectable border-b border-line px-9 py-4 text-center text-[13px] leading-relaxed whitespace-pre-wrap text-muted"><CardText text={current.front} /></div>
                <div className="selectable flex flex-1 items-center justify-center px-9 py-7 text-center text-[17px] leading-relaxed whitespace-pre-wrap text-fg" data-testid="study-answer">
                  <div>
                    <CardText text={current.back} />
                    {current.extra && (
                      <div className="mt-3 text-[13px] text-muted">
                        <CardText text={current.extra} />
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </motion.div>

        <div className="flex h-[52px] items-start">
          {flipped ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT, delay: reduceMotion ? 0 : 0.12 }}
              className="flex gap-2"
              role="group"
              aria-label="Rate your recall"
            >
              {RATINGS.map((option) => (
                <button
                  key={option.rating}
                  type="button"
                  disabled={busy}
                  onClick={() => void rate(option.rating)}
                  className={cn(
                    'flex h-[52px] w-[108px] flex-col items-center justify-center gap-0.5 rounded-lg border border-line-strong bg-surface text-fg active:scale-[0.98] disabled:opacity-50',
                    option.tone
                  )}
                >
                  <span className="flex items-center gap-2 text-[13px] font-medium">
                    {option.label}
                    <Kbd>{option.key}</Kbd>
                  </span>
                  <span className="text-[11px] text-subtle">{option.hint}</span>
                </button>
              ))}
            </motion.div>
          ) : (
            <Button variant="primary" className="h-10 px-5" onClick={() => setFlipped(true)}>
              Show answer
              <span className="rounded bg-black/20 px-1.5 py-px text-[10.5px] font-normal">Space</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
