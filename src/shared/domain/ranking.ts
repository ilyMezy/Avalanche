// Ranking for Quick Open and the sidebar's Frequent list. Pure functions.

/**
 * Scores how well `query` matches `title` (higher is better), or null when it does not match.
 *   exact title            1000
 *   title starts with it    800
 *   a word starts with it   650
 *   contains it             500
 *   letters appear in order 100–300 (closer together scores higher)
 */
export function fuzzyScore(query: string, title: string): number | null {
  const q = query.trim().toLowerCase()
  const t = title.toLowerCase()
  if (!q) return 0
  if (t === q) return 1000
  if (t.startsWith(q)) return 800 - Math.min(100, t.length - q.length)
  const index = t.indexOf(q)
  if (index !== -1) {
    const atWordStart = /[\s\-_.()/]/.test(t[index - 1] ?? ' ')
    return (atWordStart ? 650 : 500) - Math.min(100, index)
  }
  // Subsequence match: every query letter appears in order.
  let position = 0
  let gaps = 0
  let first = -1
  for (const ch of q) {
    if (ch === ' ') continue
    const found = t.indexOf(ch, position)
    if (found === -1) return null
    if (first === -1) first = found
    else gaps += found - position
    position = found + 1
  }
  return Math.max(100, 300 - gaps * 8 - first * 2)
}

export interface Rankable {
  title: string
  lastOpenedAt: number | null
}

/** Orders candidates for Quick Open: match quality first, then how recently each was opened. */
export function rankQuickOpen<T extends Rankable>(items: T[], query: string, now: number, limit = 30): T[] {
  const scored: { item: T; score: number }[] = []
  for (const item of items) {
    const match = fuzzyScore(query, item.title)
    if (match === null) continue
    const ageDays = item.lastOpenedAt === null ? Infinity : Math.max(0, now - item.lastOpenedAt) / 86_400_000
    // Recency adds at most 60 points, so it orders items within a match tier without
    // letting a stale exact match lose to a recent partial one.
    const recency = ageDays === Infinity ? 0 : 60 * Math.pow(0.5, ageDays / 7)
    scored.push({ item, score: match + recency })
  }
  scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
  return scored.slice(0, limit).map((entry) => entry.item)
}

export const FREQUENCY_WINDOW_DAYS = 60
const HALF_LIFE_DAYS = 7

/**
 * Frequency score of a document from its open events: each open counts 1 when it happens and
 * halves in weight every 7 days; opens older than 60 days are ignored. A document opened often
 * and recently therefore ranks above one opened many times long ago.
 */
export function frequencyScore(openTimes: number[], now: number): number {
  let score = 0
  for (const openedAt of openTimes) {
    const ageDays = (now - openedAt) / 86_400_000
    if (ageDays < 0 || ageDays > FREQUENCY_WINDOW_DAYS) continue
    score += Math.pow(0.5, ageDays / HALF_LIFE_DAYS)
  }
  return score
}
