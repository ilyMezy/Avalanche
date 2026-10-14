// Writing help that runs entirely on this computer, from fixed rules: corrections applied as
// you type, a short list of grammar and punctuation checks, and word completion from the words
// already in the document. It is English only and deliberately conservative: it flags what the
// rules can be sure about and says nothing about the rest. It is not a language model.

/** Common slips and their corrections, applied when the word is finished. Lower case only. */
const CORRECTIONS: Record<string, string> = {
  teh: 'the', hte: 'the', adn: 'and', nad: 'and', taht: 'that', thsi: 'this', tihs: 'this', waht: 'what', wiht: 'with', whit: 'with',
  becuase: 'because', becasue: 'because', beacuse: 'because', recieve: 'receive', recieved: 'received', acheive: 'achieve', acheived: 'achieved',
  beleive: 'believe', beleived: 'believed', freind: 'friend', freinds: 'friends', wierd: 'weird', thier: 'their', definately: 'definitely',
  definatly: 'definitely', seperate: 'separate', seperately: 'separately', occured: 'occurred', occuring: 'occurring', occurence: 'occurrence',
  untill: 'until', tommorow: 'tomorrow', tommorrow: 'tomorrow', tomorow: 'tomorrow', goverment: 'government', enviroment: 'environment',
  neccessary: 'necessary', necesary: 'necessary', accomodate: 'accommodate', adress: 'address', arguement: 'argument', begining: 'beginning',
  calender: 'calendar', collegue: 'colleague', concious: 'conscious', embarass: 'embarrass', existance: 'existence', foriegn: 'foreign',
  fourty: 'forty', grammer: 'grammar', happend: 'happened', immediatly: 'immediately', independant: 'independent', knowlege: 'knowledge',
  libary: 'library', mispell: 'misspell', noticable: 'noticeable', occassion: 'occasion', persistant: 'persistent', posession: 'possession',
  prefered: 'preferred', publically: 'publicly', realy: 'really', refered: 'referred', relevent: 'relevant', religous: 'religious',
  rythm: 'rhythm', sieze: 'seize', succesful: 'successful', successfull: 'successful', suprise: 'surprise', tendancy: 'tendency',
  therefor: 'therefore', truely: 'truly', unfortunatly: 'unfortunately', wich: 'which', whcih: 'which', writting: 'writing', acount: 'account',
  alot: 'a lot', aswell: 'as well', cant: "can't", dont: "don't", doesnt: "doesn't", didnt: "didn't", wont: "won't", isnt: "isn't", arent: "aren't",
  wasnt: "wasn't", werent: "weren't", couldnt: "couldn't", shouldnt: "shouldn't", wouldnt: "wouldn't", havent: "haven't", hasnt: "hasn't",
  hadnt: "hadn't", im: "I'm", ive: "I've", youre: "you're", theyre: "they're", thats: "that's", whats: "what's", heres: "here's", theres: "there's",
  i: 'I'
}

function matchCase(original: string, replacement: string): string {
  if (replacement[0] === 'I' && (replacement === 'I' || replacement[1] === "'")) return replacement
  if (original.length > 1 && original === original.toUpperCase()) return replacement.toUpperCase()
  if (original[0] !== original[0].toLowerCase()) return replacement[0].toUpperCase() + replacement.slice(1)
  return replacement
}

/** The corrected form of a finished word, or null when it is left alone. */
export function autocorrectWord(word: string): string | null {
  const fixed = CORRECTIONS[word.toLowerCase()]
  if (!fixed) return null
  const result = matchCase(word, fixed)
  return result === word ? null : result
}

const ABBREVIATIONS = new Set(['e.g', 'i.e', 'etc', 'vs', 'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'no', 'fig', 'approx', 'inc', 'ltd', 'jr', 'sr', 'cf'])

/** True when a word typed after `before` starts a sentence and so takes a capital letter. */
export function startsSentence(before: string): boolean {
  const trimmed = before.replace(/\s+$/, '')
  if (trimmed === '') return before === '' || /^\s*$/.test(before)
  if (!/[.!?]["')\]]?$/.test(trimmed) || before === trimmed) return false
  const last = /([\w.]+)\.["')\]]?$/.exec(trimmed)
  // "e.g. apples" and "Dr. smith" do not start a sentence; neither does a number like "3. item".
  if (last && (ABBREVIATIONS.has(last[1].toLowerCase()) || /^\d+$/.test(last[1]) || /^[A-Za-z]$/.test(last[1]))) return false
  return true
}

/**
 * What to do with the word just finished: `before` is the text of the paragraph up to and
 * including the word. Returns the replacement for that word, or null.
 */
export function autocorrectTail(before: string, boundary = ' '): { word: string; replacement: string } | null {
  const match = /([A-Za-z']+)$/.exec(before)
  if (!match) return null
  const word = match[1]
  // A lone "i" is the pronoun only when a space follows; "i.e." and "i)" are left alone.
  if (word === 'i' && boundary !== ' ') return null
  const lead = before.slice(0, before.length - word.length)
  // Words inside something code-like or an address ("user@teh.org", "path/teh") are not touched.
  if (/[@/\\_.\d-]$/.test(lead)) return null
  const fixed = autocorrectWord(word)
  let replacement = fixed ?? word
  if (/^[a-z]/.test(replacement) && startsSentence(lead)) replacement = replacement[0].toUpperCase() + replacement.slice(1)
  return replacement === word ? null : { word, replacement }
}

export interface WritingIssue {
  from: number
  to: number
  message: string
  /** The suggested text for `from`..`to`, or null when there is nothing to put in automatically. */
  replacement: string | null
  kind: 'grammar' | 'punctuation' | 'style'
}

const VOWEL_SOUND_EXCEPTIONS = /^(?:uni|use|usu|uti|eur|one|once|ubiq|uk\b|us\b|u-)/i
const SILENT_H = /^(?:hour|honest|honor|honour|heir)/i

const PHRASES: { pattern: RegExp; replacement: string | ((match: RegExpExecArray) => string); message: string }[] = [
  { pattern: /\b(could|should|would|must|might) of\b/gi, replacement: (m) => `${m[1]} have`, message: 'Use “have” after this verb, not “of”.' },
  { pattern: /\b(more|less|better|worse|rather|other|bigger|smaller|faster|slower|higher|lower|greater|fewer) then\b/gi, replacement: (m) => `${m[1]} than`, message: 'Use “than” in a comparison.' },
  { pattern: /\btheir (is|are|was|were)\b/gi, replacement: (m) => `there ${m[1]}`, message: 'Use “there” here: “their” shows possession.' },
  { pattern: /\byour (welcome|right|wrong|going|not)\b/gi, replacement: (m) => `you're ${m[1]}`, message: 'Use “you’re” (you are) here.' },
  { pattern: /\bits (a|an|the|not|been|going)\b/gi, replacement: (m) => `it's ${m[1]}`, message: 'Use “it’s” (it is) here: “its” shows possession.' },
  { pattern: /\b(he|she|it) (don't|dont)\b/gi, replacement: (m) => `${m[1]} doesn't`, message: 'Use “doesn’t” with he, she, or it.' },
  { pattern: /\b(he|she|it) (have|were|are)\b/gi, replacement: (m) => `${m[1]} ${{ have: 'has', were: 'was', are: 'is' }[m[2].toLowerCase()]}`, message: 'The verb does not agree with its subject.' },
  { pattern: /\b(you|we|they) (was|is|has|doesn't)\b/gi, replacement: (m) => `${m[1]} ${{ was: 'were', is: 'are', has: 'have', "doesn't": "don't" }[m[2].toLowerCase()]}`, message: 'The verb does not agree with its subject.' },
  { pattern: /\bI (is|has|doesn't|are)\b/g, replacement: (m) => `I ${{ is: 'am', has: 'have', "doesn't": "don't", are: 'am' }[m[1]]}`, message: 'The verb does not agree with “I”.' },
  { pattern: /\b(less) (people|students|books|cars|items|things|days|hours|words|pages|questions|mistakes)\b/gi, replacement: (m) => `fewer ${m[2]}`, message: 'Use “fewer” for things you can count.' },
  { pattern: /\b(irregardless)\b/gi, replacement: 'regardless', message: 'Use “regardless”.' },
  { pattern: /\b(in order to)\b/gi, replacement: 'to', message: '“To” is usually enough here.' }
]

/**
 * Checks one paragraph and returns what the rules are sure about, in order. Offsets are
 * positions in `text`.
 */
export function checkWriting(text: string): WritingIssue[] {
  const issues: WritingIssue[] = []
  const add = (from: number, to: number, message: string, replacement: string | null, kind: WritingIssue['kind']): void => {
    // A whole-sentence remark may sit over smaller findings inside it; other findings never overlap.
    if (kind === 'style' || !issues.some((issue) => issue.kind !== 'style' && from < issue.to && to > issue.from)) issues.push({ from, to, message, replacement, kind })
  }
  let match: RegExpExecArray | null

  const repeated = /\b([A-Za-z']+)(\s+)\1\b/gi
  while ((match = repeated.exec(text)) !== null) {
    if (/^(?:that|had|is|very|so|no|bye|ha|blah)$/i.test(match[1])) continue
    add(match.index, match.index + match[0].length, `“${match[1]}” is repeated.`, match[1], 'grammar')
  }

  for (const rule of PHRASES) {
    rule.pattern.lastIndex = 0
    while ((match = rule.pattern.exec(text)) !== null) {
      const replacement = typeof rule.replacement === 'string' ? rule.replacement : rule.replacement(match)
      add(match.index, match.index + match[0].length, rule.message, matchCase(match[0], replacement), rule.replacement === 'to' ? 'style' : 'grammar')
    }
  }

  const article = /\b(a|an)\s+([A-Za-z][A-Za-z-]*)/gi
  while ((match = article.exec(text)) !== null) {
    const [, word, next] = match
    // Single letters and all-capital abbreviations depend on how they are said aloud; left alone.
    if (next.length === 1 || next === next.toUpperCase()) continue
    const vowelSound = (/^[aeiou]/i.test(next) && !VOWEL_SOUND_EXCEPTIONS.test(next)) || SILENT_H.test(next)
    const wanted = vowelSound ? 'an' : 'a'
    if (word.toLowerCase() !== wanted) add(match.index, match.index + word.length, `Use “${wanted}” before “${next}”.`, matchCase(word, wanted), 'grammar')
  }

  const lowerStart = /(^|[.!?]["')\]]?\s+)([a-z])/g
  while ((match = lowerStart.exec(text)) !== null) {
    const at = match.index + match[1].length
    const before = text.slice(0, at)
    if (at === 0 ? /^[a-z]+[.)]\s/.test(text) || /^(?:https?:|www\.)/.test(text) : !startsSentence(before)) continue
    add(at, at + 1, 'A sentence starts with a capital letter.', match[2].toUpperCase(), 'punctuation')
  }

  const spaces = /(\S)( {2,})(?=\S)/g
  while ((match = spaces.exec(text)) !== null) add(match.index + 1, match.index + 1 + match[2].length, 'More than one space.', ' ', 'punctuation')

  const spaceBefore = /(\w) +([,.;:!?])(?=\s|$)/g
  while ((match = spaceBefore.exec(text)) !== null) add(match.index + 1, match.index + match[0].length, 'No space before this punctuation mark.', match[2], 'punctuation')

  const noSpaceAfter = /([a-z]{2,})([,;!?])([A-Za-z]{2,})/g
  while ((match = noSpaceAfter.exec(text)) !== null) add(match.index + match[1].length, match.index + match[1].length + 1, 'Add a space after this punctuation mark.', `${match[2]} `, 'punctuation')

  const sentences = text.split(/(?<=[.!?])\s+/)
  let offset = 0
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).filter(Boolean).length
    if (words > 45) add(offset, offset + sentence.length, `This sentence has ${words} words. Consider splitting it.`, null, 'style')
    offset += sentence.length + (text.slice(offset + sentence.length).match(/^\s+/)?.[0].length ?? 0)
  }

  return issues.sort((a, b) => a.from - b.from)
}

/** Applies every automatic fix to a paragraph, last to first so earlier offsets stay valid. */
export function applyFixes(text: string, issues: WritingIssue[]): string {
  let result = text
  for (const issue of [...issues].sort((a, b) => b.from - a.from)) {
    if (issue.replacement !== null) result = result.slice(0, issue.from) + issue.replacement + result.slice(issue.to)
  }
  return result
}

// ---- Word completion ------------------------------------------------------------------

const MIN_PREFIX = 3
const MIN_COMPLETION = 5

/** Counts the longer words of a text, for completion. */
export function wordFrequencies(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const word of text.match(/[A-Za-z][A-Za-z'-]{3,}[A-Za-z]/g) ?? []) counts.set(word, (counts.get(word) ?? 0) + 1)
  return counts
}

/**
 * The rest of the word being typed, taken from words already used in the document: the most
 * frequent one that starts with the same letters, or null. `counts` should not include the
 * partial word itself.
 */
export function completeWord(prefix: string, counts: Map<string, number>): string | null {
  if (prefix.length < MIN_PREFIX || !/^[A-Za-z]+$/.test(prefix)) return null
  const lower = prefix.toLowerCase()
  let best: string | null = null
  let bestCount = 0
  for (const [word, count] of counts) {
    if (word.length < MIN_COMPLETION || word.length <= prefix.length || !word.toLowerCase().startsWith(lower)) continue
    if (count > bestCount || (count === bestCount && best !== null && word.length < best.length)) {
      best = word
      bestCount = count
    }
  }
  return best ? best.slice(prefix.length) : null
}
