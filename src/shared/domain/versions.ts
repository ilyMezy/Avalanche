// Release versions: comparing them, and reading the list of published releases.

export const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/

/** Negative when `a` is older than `b`, positive when newer, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] || 0) - (right[index] || 0)
    if (difference !== 0) return difference
  }
  return 0
}

export interface ReleaseInfo {
  version: string
  name: string
  /** Release notes as plain text. */
  notes: string
  publishedAt: number | null
  relation: 'older' | 'current' | 'newer'
  /** True when the release carries the installer and its manifest, so the app can switch to it. */
  installable: boolean
}

const MAX_NOTES = 4000

/** Markdown release notes reduced to readable plain text. */
export function plainMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_NOTES)
}

/**
 * The published releases, newest first, from the release host's JSON. Drafts, pre-releases, and
 * anything whose tag is not a plain version are left out; nothing in the data is trusted beyond
 * being text to show.
 */
export function parseReleases(data: unknown, currentVersion: string): ReleaseInfo[] {
  if (!Array.isArray(data)) return []
  const out: ReleaseInfo[] = []
  const seen = new Set<string>()
  for (const item of data as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object' || item.draft === true || item.prerelease === true) continue
    const version = typeof item.tag_name === 'string' ? item.tag_name.replace(/^v/, '') : ''
    if (!VERSION_PATTERN.test(version) || seen.has(version)) continue
    seen.add(version)
    const assets = Array.isArray(item.assets) ? (item.assets as { name?: unknown }[]).map((asset) => (typeof asset?.name === 'string' ? asset.name : '')) : []
    const order = compareVersions(version, currentVersion)
    const published = typeof item.published_at === 'string' ? Date.parse(item.published_at) : NaN
    out.push({
      version,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 120) : `Version ${version}`,
      notes: typeof item.body === 'string' ? plainMarkdown(item.body) : '',
      publishedAt: Number.isFinite(published) ? published : null,
      relation: order === 0 ? 'current' : order > 0 ? 'newer' : 'older',
      installable: assets.includes('latest.yml') && assets.some((name) => name.toLowerCase().endsWith('.exe'))
    })
  }
  return out.sort((a, b) => compareVersions(b.version, a.version)).slice(0, 50)
}
