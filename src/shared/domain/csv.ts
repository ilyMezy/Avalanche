import { stripHtml } from './html'

// Delimited-text (CSV / TSV) reading for flashcard import. Pure functions: no file access.
// The parser is a character-level state machine following RFC 4180 conventions: fields may be
// wrapped in double quotes, a quoted field may contain the delimiter, line breaks, and quotes
// written as "". It never splits lines on the delimiter.

export type Delimiter = ',' | '\t' | ';' | '|'
export const DELIMITERS: { value: Delimiter; label: string }[] = [
  { value: ',', label: 'Comma' },
  { value: '\t', label: 'Tab' },
  { value: ';', label: 'Semicolon' },
  { value: '|', label: 'Pipe' }
]

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024
export const MAX_IMPORT_ROWS = 50_000

export interface DecodedText {
  text: string
  encoding: 'UTF-8' | 'UTF-16 LE' | 'UTF-16 BE' | 'Windows-1252'
}

/** Decodes file bytes: byte-order marks first, then strict UTF-8, then Windows-1252 as a fallback. */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16 LE' }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16 BE' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' }
  }
}

export interface Directives {
  text: string
  separator: Delimiter | null
  html: boolean | null
}

const SEPARATOR_NAMES: Record<string, Delimiter> = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', '\t': '\t', ',': ',', ';': ';', '|': '|' }

/** Anki text exports begin with lines such as `#separator:tab` and `#html:true`; they are read, then removed. */
export function readDirectives(text: string): Directives {
  let separator: Delimiter | null = null
  let html: boolean | null = null
  let rest = text
  for (;;) {
    const match = /^#([a-z ]+):(.*)\r?\n?/i.exec(rest)
    if (!match) break
    const key = match[1].trim().toLowerCase()
    const value = match[2].trim().toLowerCase()
    if (key === 'separator') separator = SEPARATOR_NAMES[value] ?? SEPARATOR_NAMES[match[2]] ?? separator
    if (key === 'html') html = value === 'true'
    rest = rest.slice(match[0].length)
  }
  return { text: rest, separator, html }
}

export interface ParseResult {
  rows: string[][]
  /** Problems that did not stop parsing, with the 1-based line where each began. */
  warnings: { line: number; message: string }[]
  truncated: boolean
}

export function parseDelimited(text: string, delimiter: Delimiter, maxRows = MAX_IMPORT_ROWS): ParseResult {
  const rows: string[][] = []
  const warnings: ParseResult['warnings'] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let fieldStart = true
  let line = 1
  let quoteLine = 1
  let truncated = false

  const endField = (): void => {
    row.push(field)
    field = ''
    fieldStart = true
  }
  const endRow = (): boolean => {
    endField()
    // A completely blank line is not a record.
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
    return rows.length >= maxRows
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        if (ch === '\n') line++
        field += ch
      }
      continue
    }
    if (ch === '"' && fieldStart) {
      quoted = true
      quoteLine = line
      fieldStart = false
    } else if (ch === delimiter) {
      endField()
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      line++
      if (endRow()) {
        truncated = i < text.length - 1
        break
      }
    } else {
      field += ch
      fieldStart = false
    }
  }
  if (quoted) warnings.push({ line: quoteLine, message: 'A quoted field that starts here is never closed; the rest of the file was read as part of it.' })
  if (!truncated && (field !== '' || row.length > 0)) endRow()
  return { rows, warnings, truncated }
}

/** Picks the delimiter that splits the first records into the most consistent number of columns. */
export function detectDelimiter(text: string): Delimiter {
  const sample = text.slice(0, 64_000)
  let best: Delimiter = ','
  let bestScore = -1
  for (const { value } of DELIMITERS) {
    const rows = parseDelimited(sample, value, 25).rows
    if (rows.length === 0) continue
    const counts = new Map<number, number>()
    for (const row of rows) counts.set(row.length, (counts.get(row.length) ?? 0) + 1)
    const [columns, frequency] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (columns < 2) continue
    // Consistency matters most, then the number of columns.
    const score = (frequency / rows.length) * 1000 + columns
    if (score > bestScore) {
      bestScore = score
      best = value
    }
  }
  return best
}

const HEADER_WORDS = /^(front|back|question|answer|term|definition|meaning|word|prompt|response|q|a|tags?|extra|notes?|hint|source|deck|example|translation)$/i

/** A first row made only of short, recognizable column names is treated as a header. */
export function detectHeader(rows: string[][]): boolean {
  const first = rows[0]
  if (!first || rows.length < 2) return false
  const cells = first.map((cell) => cell.trim())
  if (cells.some((cell) => cell === '' || cell.length > 40)) return false
  return cells.some((cell) => HEADER_WORDS.test(cell))
}

export type ImportField = 'front' | 'back' | 'extra' | 'tags' | 'ignore'
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  front: 'Front (question)',
  back: 'Back (answer)',
  extra: 'Extra information',
  tags: 'Tags',
  ignore: 'Do not import'
}

const FIELD_NAMES: Record<Exclude<ImportField, 'ignore'>, RegExp> = {
  front: /^(front|question|term|word|prompt|q)$/i,
  back: /^(back|answer|definition|meaning|response|translation|a)$/i,
  extra: /^(extra|notes?|hint|example|source)$/i,
  tags: /^tags?$/i
}

/** Proposes a column mapping: by header name when there is one, otherwise first column → front, second → back. */
export function guessMapping(header: string[] | null, columnCount: number): ImportField[] {
  const mapping: ImportField[] = Array.from({ length: columnCount }, () => 'ignore')
  const used = new Set<ImportField>()
  if (header) {
    header.forEach((name, index) => {
      for (const field of ['front', 'back', 'extra', 'tags'] as const) {
        if (!used.has(field) && FIELD_NAMES[field].test(name.trim()) && index < columnCount) {
          mapping[index] = field
          used.add(field)
          break
        }
      }
    })
  }
  for (const field of ['front', 'back'] as const) {
    if (used.has(field)) continue
    const free = mapping.findIndex((value) => value === 'ignore')
    if (free !== -1) {
      mapping[free] = field
      used.add(field)
    }
  }
  return mapping
}

export interface ImportCard {
  front: string
  back: string
  extra: string
  tags: string
}

export interface BuiltCards {
  cards: ImportCard[]
  /** Rows that cannot become cards, with the 1-based record number and the reason. */
  rejected: { record: number; reason: string }[]
}

const MAX_FIELD = 8000

/** Turns parsed records into cards using the chosen mapping. Text is preserved; only outer whitespace is trimmed. */
export function buildCards(rows: string[][], mapping: ImportField[], hasHeader: boolean): BuiltCards {
  const cards: ImportCard[] = []
  const rejected: BuiltCards['rejected'] = []
  const column = (field: ImportField): number => mapping.indexOf(field)
  const front = column('front')
  const back = column('back')
  const extra = column('extra')
  const tags = column('tags')
  rows.forEach((row, index) => {
    if (hasHeader && index === 0) return
    const record = index + 1
    const card: ImportCard = {
      front: (row[front] ?? '').trim(),
      back: (row[back] ?? '').trim(),
      extra: extra === -1 ? '' : (row[extra] ?? '').trim(),
      tags: tags === -1 ? '' : (row[tags] ?? '').trim().split(/[\s,;]+/).filter(Boolean).join(' ')
    }
    if (!card.front && !card.back) rejected.push({ record, reason: 'The row is empty in the mapped columns.' })
    else if (!card.front) rejected.push({ record, reason: 'The front (question) is empty.' })
    else if (!card.back) rejected.push({ record, reason: 'The back (answer) is empty.' })
    else if (card.front.length > MAX_FIELD || card.back.length > MAX_FIELD || card.extra.length > MAX_FIELD) rejected.push({ record, reason: 'A field is longer than 8,000 characters.' })
    else cards.push(card)
  })
  return { cards, rejected }
}

/**
 * The key used to decide whether two cards are duplicates: the front text with HTML removed,
 * whitespace collapsed, and letter case ignored. Two cards in the same deck with the same key
 * are duplicates.
 */
export function duplicateKey(front: string): string {
  return stripHtml(front).replace(/\s+/g, ' ').trim().toLowerCase()
}
