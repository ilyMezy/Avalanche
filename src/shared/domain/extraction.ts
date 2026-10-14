// Deterministic, rule-based extraction of draft flashcards from selected text (spec 9.4).
// No model, no network: the same selection always produces the same drafts. The rules are
// English-oriented. Drafts are only suggestions; the UI requires the user to confirm them.

export type ExtractionRule = 'F1' | 'F2' | 'F3' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7'

export interface DraftCard {
  front: string
  back: string
  rule: ExtractionRule
}

/**
 * The card format. A line written this way always becomes a flashcard, whatever else is around
 * it, so notes can be written with cards in mind:
 *
 *   Front :: Back            one card
 *   Front ::: Back           two cards, one in each direction
 *   The {{mitochondrion}} is the powerhouse of the cell.
 *                            one fill-in-the-blank card per {{…}}
 *
 * The separators need a space on both sides, so times (10:30), ratios (2::1), and C++ scope
 * (std::vector) are left alone. The looser rules R1–R7 below still apply to every other line.
 */
export const CARD_FORMAT_HELP = [
  { syntax: 'What is x -> X is this', result: 'One card: the question, then the answer' },
  { syntax: 'Term <-> Meaning', result: 'Two cards, one in each direction' }
] as const

// The arrow forms are the ones shown to users. The older `::` and `:::` separators still work.
const FORMAT_REVERSIBLE = /^(.+?)\s+(?:<->|<=>|↔|:::)\s+(.+)$/
const FORMAT_PAIR = /^(.+?)\s+(?:->|=>|→|::)\s+(.+)$/
const FORMAT_CLOZE = /\{\{([^{}]+)\}\}/g

export const RULE_LABELS: Record<ExtractionRule, string> = {
  F1: 'Arrow ( -> )',
  F2: 'Arrow, both directions ( <-> )',
  F3: 'Fill in the blank ( {{…}} )',
  R1: 'Q/A pair',
  R2: 'Question line',
  R3: 'Term and definition',
  R4: 'Definition sentence',
  R5: 'Heading and body',
  R6: 'Emphasized term',
  R7: 'Whole selection'
}

const MAX_TERM_WORDS = 8
const PRONOUNS = new Set(['it', 'this', 'that', 'these', 'those', 'there', 'he', 'she', 'they', 'we', 'i', 'you', 'what', 'which', 'who'])

const Q_LINE = /^(?:q|question)\s*[:.]\s*(.+)$/i
const A_LINE = /^(?:a|answer)\s*[:.]\s*(.*)$/i
const HEADING = /^#{1,6}\s+(.+?)\s*#*$/
const SEPARATOR = /^(.+?)(?::\s+|\s+[–—-]\s+)(.+)$/
const DEFINITION = /^(.+?)\s+(is defined as|refers to|is|are|means)\s+(.+)$/i
const EMPHASIS = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|(?<![A-Za-z0-9])_([^_\s][^_]*)_(?![A-Za-z0-9])/

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length
const stripListMarker = (s: string): string => s.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').trim()
const stripEmphasis = (s: string): string => s.replace(/\*\*|__/g, '').replace(/(^|[\s(])[*_](\S)/g, '$1$2').replace(/(\S)[*_](?=[\s).,;:!?]|$)/g, '$1')

function collectUntilBlank(lines: string[], start: number, stop?: (line: string) => boolean): { text: string; next: number } {
  const out: string[] = []
  let i = start
  while (i < lines.length && lines[i].trim() !== '' && !(stop && stop(lines[i].trim()))) {
    out.push(lines[i].trim())
    i++
  }
  return { text: out.join('\n'), next: i }
}

export function extractFlashcards(selection: string): DraftCard[] {
  const lines = selection.replace(/\r\n?/g, '\n').split('\n')
  const drafts: DraftCard[] = []
  let i = 0

  while (i < lines.length) {
    const raw = lines[i].trim()
    if (raw === '') {
      i++
      continue
    }
    const line = stripListMarker(raw)

    // F1–F3: the explicit card format wins over every heuristic.
    const reversible = FORMAT_REVERSIBLE.exec(line)
    if (reversible) {
      const [left, right] = [stripEmphasis(reversible[1].trim()), stripEmphasis(reversible[2].trim())]
      drafts.push({ front: left, back: right, rule: 'F2' }, { front: right, back: left, rule: 'F2' })
      i++
      continue
    }
    const pair = FORMAT_PAIR.exec(line)
    if (pair) {
      drafts.push({ front: stripEmphasis(pair[1].trim()), back: stripEmphasis(pair[2].trim()), rule: 'F1' })
      i++
      continue
    }
    const clozes = [...line.matchAll(FORMAT_CLOZE)]
    if (clozes.length > 0) {
      // Each {{…}} becomes its own card: that one is blanked, the others are shown in full.
      for (const target of clozes) {
        const front = line.replace(FORMAT_CLOZE, (_whole, inner: string, offset: number) => (offset === target.index ? '\u0000' : inner))
        // The blank goes in after emphasis markers are stripped, so it is not mistaken for one.
        drafts.push({ front: stripEmphasis(front).replace('\u0000', '_____'), back: target[1].trim(), rule: 'F3' })
      }
      i++
      continue
    }

    // R1: explicit "Q: … / A: …" pairs.
    const q = Q_LINE.exec(line)
    if (q) {
      let j = i + 1
      while (j < lines.length && lines[j].trim() === '') j++
      const a = j < lines.length ? A_LINE.exec(stripListMarker(lines[j].trim())) : null
      if (a) {
        const rest = collectUntilBlank(lines, j + 1, (l) => Q_LINE.test(stripListMarker(l)))
        const back = [a[1].trim(), rest.text].filter(Boolean).join('\n')
        if (back) {
          drafts.push({ front: q[1].trim(), back, rule: 'R1' })
          i = rest.next
          continue
        }
      }
    }

    const heading = HEADING.exec(raw)
    const headingText = heading ? stripEmphasis(heading[1]) : null

    // R2: a question line followed by its answer.
    const questionText = headingText ?? line
    if (questionText.endsWith('?')) {
      let j = i + 1
      if (heading) while (j < lines.length && lines[j].trim() === '') j++
      const body = collectUntilBlank(lines, j, (l) => HEADING.test(l))
      if (body.text) {
        drafts.push({ front: stripEmphasis(questionText), back: body.text, rule: 'R2' })
        i = body.next
        continue
      }
    }

    if (!heading) {
      // R3: "Term: definition" / "Term – definition".
      const sep = SEPARATOR.exec(line)
      if (sep && wordCount(sep[1]) <= MAX_TERM_WORDS && !/^https?$/i.test(sep[1])) {
        drafts.push({ front: `What is ${stripEmphasis(sep[1].trim())}?`, back: sep[2].trim(), rule: 'R3' })
        i++
        continue
      }

      // R4: "X is …", "X are …", "X refers to …", "X means …".
      const defn = DEFINITION.exec(line)
      if (defn) {
        const subject = stripEmphasis(defn[1].trim())
        const firstWord = subject.split(/\s+/)[0].toLowerCase()
        if (wordCount(subject) <= 6 && !PRONOUNS.has(firstWord) && !/[.!?,;]/.test(subject)) {
          const verb = defn[2].toLowerCase() === 'are' ? 'are' : 'is'
          drafts.push({ front: `What ${verb} ${subject}?`, back: stripEmphasis(line), rule: 'R4' })
          i++
          continue
        }
      }
    }

    // R5: a heading followed by a paragraph or list.
    if (headingText) {
      let j = i + 1
      while (j < lines.length && lines[j].trim() === '') j++
      const body = collectUntilBlank(lines, j, (l) => HEADING.test(l))
      if (body.text) {
        drafts.push({ front: headingText, back: body.text, rule: 'R5' })
        i = body.next
        continue
      }
      i++
      continue
    }

    // R6: a sentence containing an emphasized term becomes a fill-in-the-blank card.
    const emph = EMPHASIS.exec(line)
    if (emph) {
      const term = (emph[1] ?? emph[2] ?? emph[3] ?? emph[4]).trim()
      // The blank is inserted after emphasis markers are stripped, so it is not mistaken for one.
      const blanked = stripEmphasis(line.replace(emph[0], '\u0000')).replace('\u0000', '_____')
      if (term && blanked.replace(/_/g, '').trim().length > 0) {
        drafts.push({ front: blanked, back: term, rule: 'R6' })
        i++
        continue
      }
    }

    i++
  }

  // R7: nothing matched, so offer the selection as the answer with an empty question to fill in.
  if (drafts.length === 0) {
    const text = selection.trim()
    return text ? [{ front: '', back: text, rule: 'R7' }] : []
  }
  return drafts
}
