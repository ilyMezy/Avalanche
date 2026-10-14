import { eq } from 'drizzle-orm'
import { SettingsSchema } from '@shared/contracts'
import { DEFAULT_THEME, DEFAULT_UI_SCALE, normalizeAccent, normalizeTheme } from '@shared/themes'
import type { SessionState, Settings } from '@shared/types'
import { settings as settingsTable } from '../infrastructure/db/schema'
import type { AppContext } from './context'

const SESSION_KEY = 'session'

export class SettingsService {
  constructor(private readonly ctx: AppContext) {}

  private defaults(): Settings {
    return {
      theme: DEFAULT_THEME,
      accent: 'theme',
      workspacePath: this.ctx.defaultWorkspacePath,
      newDocumentBehavior: 'ask',
      quickNotesFolder: 'Quick Notes',
      autosaveDelayMs: 1500,
      editorFontSize: 14,
      markdownPreview: 'off',
      sidebarWidth: 248,
      sidebarCollapsed: false,
      uiScale: DEFAULT_UI_SCALE,
      checkForUpdates: true,
      autocorrect: true,
      autoMath: true,
      wordCompletion: true,
      docxPage: 'theme'
    }
  }

  getRaw<T>(key: string): T | undefined {
    const row = this.ctx.db.select().from(settingsTable).where(eq(settingsTable.key, key)).get()
    if (!row) return undefined
    try {
      return JSON.parse(row.valueJson) as T
    } catch {
      return undefined
    }
  }

  setRaw(key: string, value: unknown): void {
    const now = this.ctx.now()
    const valueJson = JSON.stringify(value)
    this.ctx.db
      .insert(settingsTable)
      .values({ key, valueJson, updatedAt: now })
      .onConflictDoUpdate({ target: settingsTable.key, set: { valueJson, updatedAt: now } })
      .run()
  }

  get(): Settings {
    const merged: Record<string, unknown> = { ...this.defaults() }
    for (const key of Object.keys(merged)) {
      const stored = this.getRaw(key)
      if (stored !== undefined) merged[key] = stored
    }
    // Profiles created before the Avalanche themes stored 'dark' | 'light' | 'system'.
    merged.theme = normalizeTheme(merged.theme)
    merged.accent = normalizeAccent(merged.accent)
    // A stored value that no longer validates falls back to defaults instead of breaking startup.
    const parsed = SettingsSchema.safeParse(merged)
    return parsed.success ? parsed.data : this.defaults()
  }

  update(patch: Partial<Settings>): Settings {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) this.setRaw(key, value)
    }
    return this.get()
  }

  getSession(): SessionState {
    return this.getRaw<SessionState>(SESSION_KEY) ?? { tabs: [], activeTabId: null }
  }

  saveSession(session: SessionState): void {
    this.setRaw(SESSION_KEY, session)
  }
}
