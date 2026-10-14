// The icons and colours a flashcard deck can be given. Only the identifiers are stored; the
// renderer maps each icon id to a drawing (features/flashcards/DeckIcon.tsx). The search words
// let the picker find an icon by subject, for example "chemistry" or "history".

export const DECK_ICONS = [
  { id: 'layers', words: 'cards deck default stack' },
  { id: 'graduation-cap', words: 'school study exam university degree' },
  { id: 'book-open', words: 'reading literature english book' },
  { id: 'languages', words: 'language translate vocabulary french spanish' },
  { id: 'feather', words: 'writing poetry literature essay' },
  { id: 'quote', words: 'quotes literature english speech' },
  { id: 'scroll', words: 'history document ancient law' },
  { id: 'newspaper', words: 'news current affairs media' },
  { id: 'message-circle', words: 'conversation speaking phrases' },
  { id: 'calculator', words: 'maths arithmetic numbers' },
  { id: 'pi', words: 'maths geometry constant' },
  { id: 'sigma', words: 'maths statistics sum' },
  { id: 'infinity', words: 'maths calculus limits' },
  { id: 'percent', words: 'maths finance ratio' },
  { id: 'triangle', words: 'geometry trigonometry maths' },
  { id: 'ruler', words: 'measurement geometry design' },
  { id: 'chart-line', words: 'graphs economics statistics data' },
  { id: 'chart-pie', words: 'statistics data business' },
  { id: 'atom', words: 'physics science chemistry' },
  { id: 'magnet', words: 'physics magnetism' },
  { id: 'zap', words: 'physics electricity energy' },
  { id: 'orbit', words: 'physics astronomy space' },
  { id: 'telescope', words: 'astronomy space stars' },
  { id: 'rocket', words: 'space engineering launch' },
  { id: 'radiation', words: 'physics nuclear' },
  { id: 'flask-conical', words: 'chemistry lab science' },
  { id: 'test-tube', words: 'chemistry lab biology' },
  { id: 'beaker', words: 'chemistry lab' },
  { id: 'flame', words: 'chemistry combustion energy' },
  { id: 'dna', words: 'biology genetics' },
  { id: 'microscope', words: 'biology cells lab' },
  { id: 'leaf', words: 'biology plants botany nature' },
  { id: 'sprout', words: 'biology growth plants' },
  { id: 'bug', words: 'biology insects' },
  { id: 'bird', words: 'biology animals zoology' },
  { id: 'fish', words: 'biology marine animals' },
  { id: 'paw-print', words: 'animals zoology pets' },
  { id: 'brain', words: 'psychology neuroscience memory' },
  { id: 'heart-pulse', words: 'medicine health anatomy' },
  { id: 'stethoscope', words: 'medicine doctor health' },
  { id: 'pill', words: 'medicine pharmacology drugs' },
  { id: 'syringe', words: 'medicine vaccine nursing' },
  { id: 'bone', words: 'anatomy medicine skeleton' },
  { id: 'eye', words: 'anatomy vision optics' },
  { id: 'activity', words: 'health sport physiology' },
  { id: 'dumbbell', words: 'sport fitness physical education' },
  { id: 'globe', words: 'geography world countries' },
  { id: 'earth', words: 'geography planet environment' },
  { id: 'map', words: 'geography places navigation' },
  { id: 'compass', words: 'geography navigation direction' },
  { id: 'mountain', words: 'geography geology nature' },
  { id: 'tree-pine', words: 'environment forest nature' },
  { id: 'cloud', words: 'weather climate geography' },
  { id: 'sun', words: 'weather climate energy day' },
  { id: 'moon', words: 'astronomy night' },
  { id: 'snowflake', words: 'weather climate winter' },
  { id: 'anchor', words: 'sea navy maritime' },
  { id: 'plane', words: 'travel aviation' },
  { id: 'landmark', words: 'history politics government civics' },
  { id: 'castle', words: 'history medieval' },
  { id: 'church', words: 'religion history' },
  { id: 'crown', words: 'history monarchy royalty' },
  { id: 'swords', words: 'history war conflict' },
  { id: 'shield', words: 'security defence history' },
  { id: 'hourglass', words: 'history time dates' },
  { id: 'flag', words: 'countries politics nations' },
  { id: 'scale', words: 'law justice ethics' },
  { id: 'users', words: 'sociology people society' },
  { id: 'coins', words: 'economics money finance' },
  { id: 'briefcase', words: 'business management work' },
  { id: 'palette', words: 'art painting design' },
  { id: 'pen-tool', words: 'design drawing art' },
  { id: 'camera', words: 'photography media' },
  { id: 'film', words: 'film media cinema' },
  { id: 'drama', words: 'theatre drama acting' },
  { id: 'music', words: 'music theory notes' },
  { id: 'guitar', words: 'music instrument' },
  { id: 'piano', words: 'music instrument keys' },
  { id: 'mic', words: 'music singing speech' },
  { id: 'code', words: 'programming computer science' },
  { id: 'terminal', words: 'programming shell commands' },
  { id: 'binary', words: 'computer science data' },
  { id: 'cpu', words: 'computer hardware engineering' },
  { id: 'database', words: 'computer science data sql' },
  { id: 'bot', words: 'robotics artificial intelligence' },
  { id: 'wifi', words: 'networking internet' },
  { id: 'cog', words: 'engineering mechanics' },
  { id: 'wrench', words: 'engineering tools' },
  { id: 'hammer', words: 'construction tools woodwork' },
  { id: 'utensils', words: 'cooking food nutrition' },
  { id: 'car', words: 'driving theory transport' },
  { id: 'gamepad-2', words: 'games fun' },
  { id: 'puzzle', words: 'logic problems puzzles' },
  { id: 'lightbulb', words: 'ideas facts general knowledge' },
  { id: 'key', words: 'key terms definitions' },
  { id: 'gem', words: 'geology minerals' },
  { id: 'star', words: 'favourite important' },
  { id: 'trophy', words: 'competition quiz sport' }
] as const

export type DeckIconId = (typeof DECK_ICONS)[number]['id']
export const DECK_ICON_IDS = DECK_ICONS.map((icon) => icon.id) as [DeckIconId, ...DeckIconId[]]
export const DEFAULT_DECK_ICON: DeckIconId = 'layers'

/** Deck colours. 'default' follows the app theme; the others are fixed hues readable in every theme. */
export const DECK_COLORS = {
  default: null,
  blue: '#4c9be8',
  teal: '#2fb5a3',
  green: '#4fb872',
  amber: '#e0a23a',
  orange: '#e8813a',
  red: '#e06c66',
  pink: '#e86aa6',
  violet: '#9b82f0'
} as const
export type DeckColorId = keyof typeof DECK_COLORS
export const DECK_COLOR_IDS = Object.keys(DECK_COLORS) as [DeckColorId, ...DeckColorId[]]

export function normalizeDeckIcon(value: string | null | undefined): DeckIconId {
  return DECK_ICON_IDS.includes(value as DeckIconId) ? (value as DeckIconId) : DEFAULT_DECK_ICON
}
export function normalizeDeckColor(value: string | null | undefined): DeckColorId {
  return DECK_COLOR_IDS.includes(value as DeckColorId) ? (value as DeckColorId) : 'default'
}

/** Icons matching a search: by id or by subject words; an empty query returns everything. */
export function searchDeckIcons(query: string): DeckIconId[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...DECK_ICON_IDS]
  return DECK_ICONS.filter((icon) => icon.id.includes(needle) || icon.words.includes(needle)).map((icon) => icon.id)
}
