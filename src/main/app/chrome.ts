import { THEMES, type ThemeId } from '@shared/themes'

// Window chrome colours. The window background and the native caption-button strip take the
// active theme's background, so the title bar reads as one surface with the page and nothing
// flashes before the page paints. The values come from the shared theme list, which mirrors
// each theme's `--bg` in the renderer's stylesheet.

export const TITLE_BAR_HEIGHT = 40

export function chromeColors(theme: ThemeId): { background: string; symbol: string } {
  return THEMES[theme].chrome
}

/**
 * Height of the native window-control strip for an interface scale. The page's own top bar grows
 * with the scale, so the controls drawn over it by Windows have to grow with it.
 */
export function titleBarHeight(scale: number): number {
  return Math.round(TITLE_BAR_HEIGHT * scale)
}
