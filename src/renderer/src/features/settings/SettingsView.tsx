import { CheckCircle2, CircleAlert, DatabaseBackup, FolderOpen, RefreshCw } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { ACCENT_IDS, ACCENT_LABELS, ACCENT_SWATCHES, THEME_IDS, THEMES, UI_SCALES } from '@shared/themes'
import type { Settings, TexToolchain } from '@shared/types'
import { Logo } from '@/components/Logo'
import { cn } from '@/lib/utils'
import { updateSettings } from '@/app/actions'
import { useAppStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Segmented, Select } from '@/components/ui/controls'
import { confirmDialog } from '@/components/ui/dialogs'
import { SectionHeader, toast } from '@/components/ui/feedback'
import { GreetingBackgroundSetting } from '@/features/home/HomeWidgets'
import { checkForUpdates, UpdateActions, updateSummary, useUpdates, VersionHistoryButton } from '@/features/updates/updates'
import { call, errorMessage } from '@/lib/api'
import { invalidate } from '@/lib/useData'
import { flushAll } from '@/lib/useSaver'

function Group({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="mt-7" aria-label={title}>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted">{title}</h2>
      <div className="divide-y divide-line rounded-xl border border-line bg-surface">{children}</div>
    </section>
  )
}

function Row({ label, description, icon, children }: { label: string; description?: ReactNode; icon?: ReactNode; children?: ReactNode }): ReactNode {
  return (
    <div className="flex items-center gap-6 px-4 py-3">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-fg">{label}</div>
        {description && <div className="selectable mt-0.5 text-xs leading-relaxed break-words text-muted">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

export function SettingsView(): ReactNode {
  const settings = useAppStore((state) => state.settings)
  const info = useAppStore((state) => state.info)
  const updates = useUpdates((store) => store.state)
  const [toolchain, setToolchain] = useState<TexToolchain | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void call('latex.toolchain').then(setToolchain, () => undefined)
  }, [])

  if (!settings || !info) return null
  const set = (patch: Partial<Omit<Settings, 'workspacePath'>>): void => void updateSettings(patch)

  const changeWorkspace = async (): Promise<void> => {
    const confirmed = await confirmDialog({
      title: 'Change the workspace folder?',
      body: 'You will choose another folder to use as your workspace. Your current files stay where they are and are not moved or deleted. Open tabs will be closed. Favorites and pins are remembered per workspace.',
      confirmLabel: 'Choose folder…'
    })
    if (!confirmed) return
    setBusy(true)
    try {
      await flushAll()
      const updated = await call('app.chooseWorkspace')
      if (updated) {
        useAppStore.setState({ settings: updated, info: await call('app.info'), tabs: [], activeTabId: null, folder: '', selectedNoteId: null })
        invalidate('workspace', 'settings')
        toast('Workspace changed.')
      }
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const rescan = async (): Promise<void> => {
    setBusy(true)
    await call('workspace.rescan').catch((error) => toast(errorMessage(error), 'error'))
    invalidate('workspace')
    setBusy(false)
    toast('The workspace index is up to date.')
  }

  const backup = async (): Promise<void> => {
    try {
      const result = await call('app.backupNow')
      toast(`Database snapshot saved: ${result.path}`)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-8 py-7 pb-16">
        <SectionHeader title="Settings" description="Preferences are stored on this computer. There is no account and nothing is synchronized." />

        <Group title="Appearance">
          <div className="px-4 py-3">
            <div className="text-[13px] text-fg">Theme</div>
            <div className="mt-0.5 text-xs text-muted">Each theme restyles the whole app. Your choice is remembered and applied before the window appears.</div>
            <div role="radiogroup" aria-label="Theme" className="mt-3 grid grid-cols-4 gap-2.5">
              {THEME_IDS.map((id) => {
                const theme = THEMES[id]
                const selected = settings.theme === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={theme.name}
                    title={theme.description}
                    data-testid={`theme-${id}`}
                    onClick={() => set({ theme: id })}
                    className={cn('rounded-lg border p-1.5 text-left', selected ? 'border-accent shadow-[0_0_0_3px_var(--accent-soft)]' : 'border-line hover:border-line-strong')}
                  >
                    {/* A miniature of the theme: sidebar, page surface, a text line, and the accent. */}
                    <span className="flex h-[58px] overflow-hidden rounded-[5px]" style={{ background: theme.swatch.bg }}>
                      <span className="w-[28%]" style={{ background: theme.swatch.sidebar }} />
                      <span className="flex flex-1 flex-col gap-1.5 p-2">
                        <span className="h-1.5 w-3/4 rounded-full" style={{ background: theme.swatch.text, opacity: 0.85 }} />
                        <span className="h-1.5 w-1/2 rounded-full" style={{ background: theme.swatch.text, opacity: 0.4 }} />
                        <span className="mt-auto flex items-center gap-1.5">
                          <span className="h-3 w-7 rounded-[3px]" style={{ background: theme.swatch.accent }} />
                          <span className="h-3 flex-1 rounded-[3px]" style={{ background: theme.swatch.surface }} />
                        </span>
                      </span>
                    </span>
                    <span className="mt-1.5 flex items-center gap-1 px-0.5 text-xs text-fg">
                      <span className="flex-1 truncate">{theme.name}</span>
                      {selected && <CheckCircle2 size={12} className="shrink-0 text-accent-text" />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <Row label="Accent colour" description="Optional. Every choice keeps text and buttons readable in the current theme.">
            <div role="radiogroup" aria-label="Accent colour" className="flex items-center gap-1.5">
              {ACCENT_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={settings.accent === id}
                  aria-label={ACCENT_LABELS[id]}
                  title={ACCENT_LABELS[id]}
                  onClick={() => set({ accent: id })}
                  className={cn('flex h-6 items-center justify-center rounded-full border-2', id === 'theme' ? 'px-2 text-[11px] text-muted' : 'w-6', settings.accent === id ? 'border-fg' : 'border-transparent')}
                  style={id === 'theme' ? undefined : { background: ACCENT_SWATCHES[id] }}
                >
                  {id === 'theme' ? 'Theme' : null}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Document page" description="How the page looks while you write. Saved and exported documents are always black on white, whatever you choose here.">
            <Segmented
              label="Document page"
              value={settings.docxPage}
              onChange={(docxPage) => set({ docxPage })}
              options={[
                { value: 'theme', label: 'Match theme' },
                { value: 'paper', label: 'White paper' }
              ]}
            />
          </Row>
          <Row label="Interface size" description="Makes everything in the window larger or smaller: text, buttons, and spacing.">
            <Select aria-label="Interface size" className="w-[190px]" value={settings.uiScale} onChange={(event) => set({ uiScale: Number(event.target.value) })}>
              {(UI_SCALES.some((option) => option.value === settings.uiScale) ? UI_SCALES : [...UI_SCALES, { value: settings.uiScale, label: `Custom (${Math.round(settings.uiScale * 100)}%)` }]).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="Editor text size" description="Applies to the Markdown and LaTeX source editors.">
            <Select aria-label="Editor text size" className="w-[110px]" value={settings.editorFontSize} onChange={(event) => set({ editorFontSize: Number(event.target.value) })}>
              {[12, 13, 14, 15, 16, 18, 20].map((size) => (
                <option key={size} value={size}>
                  {size} px
                </option>
              ))}
            </Select>
          </Row>
        </Group>

        <Group title="Home">
          <Row label="Greeting background" description="A picture of your own behind “Good morning” at the top of Home. It is copied into the app, so moving or deleting the original does not remove it.">
            <GreetingBackgroundSetting />
          </Row>
        </Group>

        <Group title="Workspace">
          <Row
            label="Workspace folder"
            description={
              <>
                <span data-testid="workspace-path">{info.workspacePath}</span>
                <br />
                Your documents are ordinary files in this folder. Other programs can open them, and you can back the folder up however you like.
              </>
            }
          >
            <Button onClick={() => void call('app.openPath', { target: 'workspace' })}>
              <FolderOpen size={14} />
              Open
            </Button>
            <Button disabled={busy} onClick={() => void changeWorkspace()}>
              Change…
            </Button>
          </Row>
          <Row label="Rescan the workspace" description="Brings the app's index in line with the folder after files were changed by other programs.">
            <Button disabled={busy} onClick={() => void rescan()}>
              <RefreshCw size={14} />
              Rescan
            </Button>
          </Row>
        </Group>

        <Group title="Documents">
          <Row label="“New” button" description="Which document type is selected first when you create something new.">
            <Select
              aria-label="Default document type"
              className="w-[230px]"
              value={settings.newDocumentBehavior}
              onChange={(event) => set({ newDocumentBehavior: event.target.value as Settings['newDocumentBehavior'] })}
            >
              <option value="ask">Document (ask each time)</option>
              <option value="docx">Document (.docx)</option>
              <option value="markdown">Markdown note</option>
              <option value="latex_project">LaTeX project</option>
              <option value="slides">Slides (.pptx)</option>
            </Select>
          </Row>
          <Row label="Autosave delay" description="How long after you stop typing changes are written to disk. Changes are also saved when the window loses focus and before the app closes.">
            <Select aria-label="Autosave delay" className="w-[130px]" value={settings.autosaveDelayMs} onChange={(event) => set({ autosaveDelayMs: Number(event.target.value) })}>
              <option value={800}>0.8 seconds</option>
              <option value={1500}>1.5 seconds</option>
              <option value={2000}>2 seconds</option>
              <option value={5000}>5 seconds</option>
            </Select>
          </Row>
          <Row label="Markdown preview" description="How Markdown documents open. Quick Notes always open in source view.">
            <Segmented
              label="Markdown preview"
              value={settings.markdownPreview}
              onChange={(markdownPreview) => set({ markdownPreview })}
              options={[
                { value: 'off', label: 'Source' },
                { value: 'split', label: 'Split' },
                { value: 'preview', label: 'Preview' }
              ]}
            />
          </Row>
        </Group>

        <Group title="Writing help">
          {(
            [
              ['autocorrect', 'Correct as I type', 'Fixes common slips such as “teh” and “dont”, and capitalizes the first word of a sentence, in documents.'],
              ['autoMath', 'Work out sums', 'Type a sum followed by “=” and a space, for example “12*4=”, and the answer is written for you. Works in documents and Markdown notes.'],
              ['wordCompletion', 'Suggest the rest of a word', 'Shows the rest of a word you have already used in the document; press Tab to accept it.']
            ] as const
          ).map(([key, label, description]) => (
            <Row key={key} label={label} description={description}>
              <input type="checkbox" aria-label={label} checked={settings[key]} onChange={(event) => set({ [key]: event.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
            </Row>
          ))}
          <Row
            label="Spelling and grammar"
            description="Spelling is checked by Windows as you type: right-click an underlined word for suggestions. “Check writing” in the document toolbar lists grammar and punctuation findings with one-click fixes. Both work offline and cover English; the grammar check follows fixed rules, so it catches common slips, not everything."
          />
        </Group>

        <Group title="LaTeX">
          <Row
            label="TeX compiler"
            description={
              toolchain === null ? (
                'Looking for an installed TeX distribution…'
              ) : toolchain.available ? (
                <>
                  <span className="inline-flex items-center gap-1.5 text-success">
                    <CheckCircle2 size={12} />
                    Found {toolchain.distribution}
                  </span>
                  <br />
                  {toolchain.version}
                  <br />
                  {toolchain.enginePath}
                  <br />
                  Projects compile locally with shell escape disabled. Automatic package installation is switched off, so nothing is downloaded.
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1.5 text-warning">
                    <CircleAlert size={12} />
                    No TeX distribution was found
                  </span>
                  <br />
                  Editing LaTeX projects works without one. To compile PDFs, install MiKTeX or TeX Live and restart the app. This app does not download or install it for you.
                </>
              )
            }
          />
        </Group>

        <Group title="Data and backup">
          <Row
            label="Application database"
            description={
              <>
                {info.databasePath}
                <br />
                Holds flashcards, review history, tasks, reminders, settings, and the search index. It never holds the only copy of a document.
              </>
            }
          >
            <Button onClick={() => void call('app.openPath', { target: 'userData' })}>
              <FolderOpen size={14} />
              Open folder
            </Button>
          </Row>
          <Row
            label="Database snapshots"
            description={
              <>
                {info.backupsPath}
                <br />
                A snapshot is taken automatically each time the app starts (the 10 most recent are kept). To back up everything, copy your workspace folder
                and a snapshot. A one-step backup archive and restore are not built yet.
              </>
            }
          >
            <Button onClick={() => void backup()}>
              <DatabaseBackup size={14} />
              Snapshot now
            </Button>
            <Button onClick={() => void call('app.openPath', { target: 'backups' })}>Open</Button>
          </Row>
        </Group>

        <Group title="Updates">
          <Row
            label="Check for updates automatically"
            description="Shortly after the app starts, and every few hours while it is open, the app asks the project’s GitHub releases page whether a newer version exists. This is the only time the app uses the internet. Nothing about you or your documents is sent, and nothing is downloaded until you choose to."
          >
            <input
              type="checkbox"
              aria-label="Check for updates automatically"
              checked={settings.checkForUpdates}
              onChange={(event) => set({ checkForUpdates: event.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
          </Row>
          {updates && (
            <Row label={`Version ${updates.currentVersion}`} description={<span data-testid="update-status">{updateSummary(updates)}</span>}>
              <UpdateActions state={updates} />
              <VersionHistoryButton disabled={updates.status === 'disabled'} />
              <Button disabled={updates.status === 'disabled' || updates.status === 'checking' || updates.status === 'downloading'} onClick={() => void checkForUpdates()}>
                Check now
              </Button>
            </Row>
          )}
        </Group>

        <Group title="About">
          <Row
            label="Avalanche"
            icon={<Logo size={40} />}
            description={
              <>
                Version {info.version} · Electron {info.electron} · Chromium {info.chrome} · Node {info.node}
                <br />
                Works offline: no account, no cloud service, no telemetry. The window that holds your documents cannot reach the network; the only connection the app makes is the update check described above.
              </>
            }
          />
          <Row
            label="Known limitations of this version"
            description="Documents are edited on one continuous page (no pagination, headers, or footers yet). Word files written by other programs are converted with a limited importer. Reminders are delivered only while the app is running."
          />
        </Group>
      </div>
    </div>
  )
}
