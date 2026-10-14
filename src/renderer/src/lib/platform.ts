// Small differences between Windows, Linux, and macOS that the interface has to respect.

/** True on macOS. Read from the browser, because the sandboxed window has no `process`. */
export const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent)

/** The command modifier: Cmd on macOS, Ctrl elsewhere. */
export function isMod(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return IS_MAC ? event.metaKey : event.ctrlKey
}

/**
 * A shortcut written the Windows way ("Ctrl+Shift+K") as it reads on this system. On macOS that
 * is "⇧⌘K"; elsewhere it is unchanged.
 */
export function keyLabel(shortcut: string): string {
  if (!IS_MAC) return shortcut
  const parts = shortcut.split('+')
  const key = parts.pop() ?? ''
  const symbols: Record<string, string> = { Ctrl: '⌘', Shift: '⇧', Alt: '⌥' }
  // macOS lists modifiers in a fixed order: Option, Shift, Command.
  const order = ['Alt', 'Shift', 'Ctrl']
  const modifiers = order.filter((name) => parts.includes(name)).map((name) => symbols[name])
  return modifiers.join('') + (key === 'Enter' ? '↩' : key)
}
