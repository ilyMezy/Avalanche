import { macWindowButtons, THEMES, TOP_BAR_HEIGHT, type ThemeId } from '@shared/themes'

// Window chrome colours. The window background and the native caption-button strip take the
// active theme's background, so the title bar reads as one surface with the page and nothing
// flashes before the page paints. The values come from the shared theme list, which mirrors
// each theme's `--bg` in the renderer's stylesheet.

export const TITLE_BAR_HEIGHT = TOP_BAR_HEIGHT

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

/** Where the macOS window buttons go for an interface scale: centred on the page's top strip. */
export function macButtonPosition(scale: number): { x: number; y: number } {
  const { x, y } = macWindowButtons(scale)
  return { x, y }
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The default window size, and the smallest the window can be made. Window points. */
export const DEFAULT_WINDOW = { width: 1320, height: 860 }
export const MIN_WINDOW = { width: 720, height: 500 }

/**
 * Where the window opens: the saved size and position, or the default size, made to fit the
 * screen it opens on, so a small or high-scaling laptop screen never cuts the window off. A saved
 * position is kept only while its top-left corner is still on one of the screens.
 */
export function fitWindowBounds(
  saved: Partial<Rect> | undefined,
  workAreas: Rect[],
  primary: Rect
): { bounds: Partial<Rect> & { width: number; height: number }; min: { width: number; height: number } } {
  const { x, y } = saved ?? {}
  const savedArea = x !== undefined && y !== undefined ? workAreas.find((area) => x >= area.x && y >= area.y && x < area.x + area.width && y < area.y + area.height) : undefined
  const area = savedArea ?? primary
  const min = { width: Math.min(MIN_WINDOW.width, area.width), height: Math.min(MIN_WINDOW.height, area.height) }
  // A first launch leaves a margin around the default size; a size the user chose may fill the screen.
  const room = saved?.width ? area : { width: Math.round(area.width * 0.92), height: Math.round(area.height * 0.92) }
  const width = Math.max(min.width, Math.min(saved?.width ?? DEFAULT_WINDOW.width, room.width))
  const height = Math.max(min.height, Math.min(saved?.height ?? DEFAULT_WINDOW.height, room.height))
  if (!savedArea) return { bounds: { width, height }, min }
  return {
    bounds: {
      x: Math.min(Math.max(x!, area.x), area.x + area.width - width),
      y: Math.min(Math.max(y!, area.y), area.y + area.height - height),
      width,
      height
    },
    min
  }
}
