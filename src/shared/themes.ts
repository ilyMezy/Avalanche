// The five Avalanche themes. This module is the single list of theme identities shared by the
// main process (window chrome colours, settings validation), the preload (first-paint theme),
// and the renderer (theme picker). The actual colours of each theme live in the renderer's
// styles/index.css under `.theme-<id>`; `chrome.background` here must equal that theme's --bg.

export const THEME_IDS = ['avalanche', 'glacier', 'aurora', 'forest', 'obsidian', 'alpenglow', 'summit', 'crevasse'] as const
export type ThemeId = (typeof THEME_IDS)[number]

export interface ThemeMeta {
  id: ThemeId
  name: string
  description: string
  dark: boolean
  /** Window background and caption-button colour, applied before the page paints. */
  chrome: { background: string; symbol: string }
  /** Representative colours for the theme picker preview. */
  swatch: { sidebar: string; bg: string; surface: string; text: string; accent: string }
}

export const THEMES: Record<ThemeId, ThemeMeta> = {
  avalanche: {
    id: 'avalanche',
    name: 'Avalanche Night',
    description: 'Midnight blue with glacier-blue accents and snow highlights.',
    dark: true,
    chrome: { background: '#0b1220', symbol: '#93a4c0' },
    swatch: { sidebar: '#080e1a', bg: '#0b1220', surface: '#111a2c', text: '#e8eef8', accent: '#5aa9e6' }
  },
  glacier: {
    id: 'glacier',
    name: 'Glacier Light',
    description: 'Snow white and ice gray with pale blue accents.',
    dark: false,
    chrome: { background: '#f7f9fc', symbol: '#55637a' },
    swatch: { sidebar: '#eef2f8', bg: '#f7f9fc', surface: '#ffffff', text: '#1a2333', accent: '#2f7fc4' }
  },
  aurora: {
    id: 'aurora',
    name: 'Aurora',
    description: 'Deep indigo and violet with teal aurora accents.',
    dark: true,
    chrome: { background: '#0e0b1f', symbol: '#a39ac4' },
    swatch: { sidebar: '#0a0817', bg: '#0e0b1f', surface: '#17122e', text: '#ece9f8', accent: '#3ec9b0' }
  },
  forest: {
    id: 'forest',
    name: 'Alpine Forest',
    description: 'Dark evergreen with muted pine and cool stone neutrals.',
    dark: true,
    chrome: { background: '#0c1512', symbol: '#93a89d' },
    swatch: { sidebar: '#09100e', bg: '#0c1512', surface: '#13201b', text: '#e6ede8', accent: '#6fb18a' }
  },
  obsidian: {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'Near-black and neutral gray with minimal colour.',
    dark: true,
    chrome: { background: '#0a0a0a', symbol: '#9a9a9a' },
    swatch: { sidebar: '#060606', bg: '#0a0a0a', surface: '#141414', text: '#ededed', accent: '#d4d4d4' }
  },
  alpenglow: {
    id: 'alpenglow',
    name: 'Alpenglow',
    description: 'Dusk plum and slate with the rose light of a summit at sunset.',
    dark: true,
    chrome: { background: '#17111c', symbol: '#b8a3b8' },
    swatch: { sidebar: '#120d17', bg: '#17111c', surface: '#211827', text: '#f3e9ee', accent: '#e8846f' }
  },
  summit: {
    id: 'summit',
    name: 'Summit Dawn',
    description: 'Warm morning light on snow: cream surfaces with a sunrise accent.',
    dark: false,
    chrome: { background: '#fbf8f3', symbol: '#6b6156' },
    swatch: { sidebar: '#f3eee6', bg: '#fbf8f3', surface: '#ffffff', text: '#2a2520', accent: '#c2622d' }
  },
  crevasse: {
    id: 'crevasse',
    name: 'Crevasse',
    description: 'The deep blue-green of glacial ice, with bright meltwater accents.',
    dark: true,
    chrome: { background: '#07171b', symbol: '#8fb3b8' },
    swatch: { sidebar: '#051215', bg: '#07171b', surface: '#0d2227', text: '#e2f1f2', accent: '#35c6d3' }
  }
}

export const DEFAULT_THEME: ThemeId = 'avalanche'

/** Optional accent override. 'theme' keeps the theme's own accent. Each is a vetted, readable colour. */
export const ACCENT_IDS = ['theme', 'ice', 'teal', 'violet', 'amber', 'rose'] as const
export type AccentId = (typeof ACCENT_IDS)[number]
export const ACCENT_LABELS: Record<AccentId, string> = {
  theme: 'Theme default',
  ice: 'Ice blue',
  teal: 'Teal',
  violet: 'Violet',
  amber: 'Amber',
  rose: 'Rose'
}
export const ACCENT_SWATCHES: Record<Exclude<AccentId, 'theme'>, string> = {
  ice: '#4f9fe0',
  teal: '#2fb5a0',
  violet: '#8b7cf0',
  amber: '#d9962f',
  rose: '#e0688a'
}

/** Accepts a stored value, including the pre-Avalanche 'dark' | 'light' | 'system' settings. */
export function normalizeTheme(value: unknown): ThemeId {
  if (typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)) return value as ThemeId
  if (value === 'light') return 'glacier'
  return DEFAULT_THEME
}

export function normalizeAccent(value: unknown): AccentId {
  return typeof value === 'string' && (ACCENT_IDS as readonly string[]).includes(value) ? (value as AccentId) : 'theme'
}

/** Interface sizes offered in Settings. The whole window is scaled, like zooming a web page. */
export const UI_SCALES = [
  { value: 1, label: 'Compact (100%)' },
  { value: 1.15, label: 'Comfortable (115%)' },
  { value: 1.3, label: 'Large (130%)' },
  { value: 1.45, label: 'Extra large (145%)' }
] as const
export const DEFAULT_UI_SCALE = 1.15
