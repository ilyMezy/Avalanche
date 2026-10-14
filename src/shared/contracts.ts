import { z } from 'zod'
import { CHANNEL_NAMES, EVENT_CHANNEL } from './channels'
import { DECK_COLOR_IDS, DECK_ICON_IDS } from './domain/deck-style'
import { VERSION_PATTERN, type ReleaseInfo } from './domain/versions'
import { HOME_IMAGE_ID, MAX_GOAL_TARGET, MAX_GOALS, MAX_WIDGETS, WIDGET_TYPES, type HomeConfig } from './domain/home'
import { DEFAULT_THEME, MAX_PDF_SLIDES, MAX_SLIDES, SHAPE_KINDS, SLIDE_FONTS, SLIDE_TEMPLATES } from './domain/slides'
import { ACCENT_IDS, THEME_IDS } from './themes'
import type {
  SlidesDocument,
  UpdateState,
  AppInfo,
  FrequentDoc,
  ImportSummary,
  PomodoroSnapshot,
  TrashItem,
  Card,
  CompileResult,
  Deck,
  DocxDocument,
  Entry,
  FlashcardSummary,
  FolderNode,
  LatexProject,
  QuickNote,
  Reminder,
  SaveResult,
  SearchHit,
  SessionState,
  Settings,
  StudyCard,
  Task,
  TexToolchain,
  TextDocument,
  TiptapNode
} from './types'

// Every IPC channel is declared exactly once here: its name, the Zod schema that the main
// process validates the request with, and the response type. The preload API, the renderer
// client, and the main-process handlers are all typed from this object (spec ARC-10..12).

const Id = z.uuid()
const RelPath = z.string().max(2000)
const Name = z.string().min(1).max(255)
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const TimeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const RecurrenceSchema = z.enum(['none', 'daily', 'weekly', 'monthly'])
const DocumentKindSchema = z.enum(['docx', 'markdown', 'latex_project', 'slides'])
const Version = z.string().max(128)
const None = z.void()

// A presentation as the Slides editor sends it. Pictures travel as data URLs of the three
// formats the exporter writes; nothing here can name a file or a URL.
const Color = z.string().regex(/^#[0-9a-f]{6}$/i)
const SlideImageData = z
  .string()
  .max(15_000_000)
  .regex(/^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/]+=*$/)
const box = {
  id: z.string().min(1).max(64),
  x: z.number().min(-20000).max(20000),
  y: z.number().min(-20000).max(20000),
  w: z.number().min(1).max(20000),
  h: z.number().min(1).max(20000),
  // Fields added after the first Slides build have defaults, so earlier files still open exactly.
  rotation: z.number().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1)
}
const SlideFontSchema = z.enum(SLIDE_FONTS)
const SlideElementSchema = z.discriminatedUnion('type', [
  z.object({
    ...box,
    type: z.literal('text'),
    text: z.string().max(20_000),
    fontFamily: SlideFontSchema.default('Calibri'),
    fontSize: z.number().min(4).max(400),
    bold: z.boolean(),
    italic: z.boolean(),
    underline: z.boolean().default(false),
    color: Color,
    align: z.enum(['left', 'center', 'right']),
    valign: z.enum(['top', 'middle', 'bottom']).default('top'),
    list: z.enum(['none', 'bullet', 'number']).default('none')
  }),
  z.object({ ...box, type: z.literal('image'), src: SlideImageData }),
  z.object({
    ...box,
    type: z.literal('shape'),
    shape: z.enum(SHAPE_KINDS),
    fill: Color,
    stroke: Color.default('#1e3a8a'),
    strokeWidth: z.number().min(0).max(100).default(0)
  })
])
const SlideThemeSchema = z.object({
  id: z.string().min(1).max(32),
  background: Color,
  title: Color,
  text: Color,
  muted: Color,
  accent: Color,
  accent2: Color,
  headingFont: SlideFontSchema,
  bodyFont: SlideFontSchema,
  decor: z.enum(['none', 'bar', 'corner', 'band'])
})
export const PresentationSchema = z.object({
  width: z.number().int().min(100).max(5000),
  height: z.number().int().min(100).max(5000),
  theme: SlideThemeSchema.default(DEFAULT_THEME),
  slideNumbers: z.boolean().default(false),
  slides: z
    .array(z.object({ id: z.string().min(1).max(64), background: Color, elements: z.array(SlideElementSchema).max(300), notes: z.string().max(20_000) }))
    .min(1)
    .max(MAX_SLIDES)
})

const TiptapNodeSchema: z.ZodType<TiptapNode> = z.lazy(() =>
  z.object({
    type: z.string().max(64),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(TiptapNodeSchema).optional(),
    text: z.string().optional(),
    marks: z
      .array(z.object({ type: z.string().max(64), attrs: z.record(z.string(), z.unknown()).optional() }))
      .optional()
  })
)

export const SettingsSchema = z.object({
  theme: z.enum(THEME_IDS),
  accent: z.enum(ACCENT_IDS),
  workspacePath: z.string(),
  newDocumentBehavior: z.enum(['ask', 'docx', 'markdown', 'latex_project', 'slides']),
  quickNotesFolder: Name,
  autosaveDelayMs: z.number().int().min(500).max(10000),
  editorFontSize: z.number().int().min(11).max(22),
  markdownPreview: z.enum(['off', 'split', 'preview']),
  sidebarWidth: z.number().int().min(200).max(420),
  sidebarCollapsed: z.boolean(),
  uiScale: z.number().min(0.8).max(1.75),
  checkForUpdates: z.boolean(),
  autocorrect: z.boolean(),
  autoMath: z.boolean(),
  wordCompletion: z.boolean(),
  docxPage: z.enum(['theme', 'paper'])
})
// The workspace location is changed only through `app.chooseWorkspace` (a native folder
// dialog in the main process), never by a path supplied from the renderer.
export const SettingsPatchSchema = SettingsSchema.omit({ workspacePath: true }).partial()

const HomeImageId = z.string().regex(HOME_IMAGE_ID)
const HomeConfigSchema = z.object({
  heroImage: HomeImageId.nullable().default(null),
  widgets: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        type: z.enum(WIDGET_TYPES),
        column: z.enum(['main', 'side']),
        imageId: HomeImageId.nullable(),
        title: z.string().max(120),
        text: z.string().max(4000)
      })
    )
    .max(MAX_WIDGETS),
  goals: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        title: z.string().trim().min(1).max(200),
        done: z.boolean(),
        target: z.number().int().min(0).max(MAX_GOAL_TARGET),
        progress: z.number().int().min(0).max(MAX_GOAL_TARGET)
      })
    )
    .max(MAX_GOALS)
})

const def =
  <Res>() =>
  <S extends z.ZodType>(req: S) => ({ req, _res: undefined as unknown as Res })

export const contract = {
  'app.info': def<AppInfo>()(None),
  'app.openPath': def<void>()(z.object({ target: z.enum(['workspace', 'userData', 'backups']) })),
  'app.openExternal': def<boolean>()(z.object({ url: z.string().max(2048) })),
  'app.chooseWorkspace': def<Settings | null>()(None),
  'app.backupNow': def<{ path: string }>()(None),
  'app.setChrome': def<void>()(z.object({ theme: z.enum(THEME_IDS) })),
  // The renderer's answer to a close request: 'proceed' once everything is saved (or the user
  // chose to discard), 'hold' while it asks the user about changes that could not be saved.
  'app.closeDecision': def<void>()(z.object({ action: z.enum(['proceed', 'hold']) })),

  // Updates. The main process talks to the release host; the renderer only sees this state.
  'updates.state': def<UpdateState>()(None),
  'updates.check': def<UpdateState>()(None),
  'updates.download': def<void>()(None),
  'updates.install': def<void>()(None),
  // Version history: every published release, and switching to one of them (newer or older).
  'updates.releases': def<ReleaseInfo[]>()(None),
  'updates.switchTo': def<UpdateState>()(z.object({ version: z.string().regex(VERSION_PATTERN) })),

  // The Home page: its widgets, the user's goals, and their own pictures. A picture is chosen
  // in a native dialog and copied into the profile; the renderer only ever holds its id.
  'home.get': def<HomeConfig>()(None),
  'home.save': def<HomeConfig>()(HomeConfigSchema),
  'home.pickImage': def<{ imageId: string } | null>()(None),
  'home.image': def<string | null>()(z.object({ id: HomeImageId })),

  'settings.get': def<Settings>()(None),
  'settings.update': def<Settings>()(SettingsPatchSchema),
  'session.get': def<SessionState>()(None),
  'session.save': def<void>()(z.object({ tabs: z.array(Id).max(50), activeTabId: Id.nullable() })),

  'workspace.list': def<Entry[]>()(z.object({ parentPath: RelPath })),
  'workspace.tree': def<FolderNode[]>()(None),
  'workspace.get': def<Entry | null>()(z.object({ id: Id })),
  'workspace.createFolder': def<Entry>()(z.object({ parentPath: RelPath, name: Name })),
  'workspace.createDocument': def<Entry>()(
    z.object({
      parentPath: RelPath,
      name: Name,
      kind: DocumentKindSchema,
      template: z.enum(['article', 'report']).optional(),
      // For slides: which starter template to create the deck from.
      slidesTemplate: z.enum(SLIDE_TEMPLATES.map((template) => template.id) as [string, ...string[]]).optional()
    })
  ),
  // Opens a native file dialog and copies the chosen .pptx, .pdf, .docx, or .md files into the
  // folder. The renderer never supplies a source path.
  'workspace.importFiles': def<Entry[]>()(z.object({ parentPath: RelPath })),
  'workspace.rename': def<Entry>()(z.object({ id: Id, name: Name })),
  'workspace.move': def<Entry>()(z.object({ id: Id, targetParentPath: RelPath })),
  'workspace.delete': def<void>()(z.object({ id: Id })),
  'workspace.setFavorite': def<Entry>()(z.object({ id: Id, value: z.boolean() })),
  'workspace.setPinned': def<Entry>()(z.object({ id: Id, value: z.boolean() })),
  'workspace.markOpened': def<void>()(z.object({ id: Id })),
  'workspace.recents': def<Entry[]>()(
    z.object({ limit: z.number().int().min(1).max(50), scope: z.enum(['documents', 'notes']) })
  ),
  'workspace.favorites': def<Entry[]>()(None),
  'workspace.frequent': def<FrequentDoc[]>()(None),
  'workspace.setFrequentPinned': def<void>()(z.object({ id: Id, value: z.boolean() })),
  'workspace.removeFrequent': def<void>()(z.object({ id: Id })),
  'workspace.quickOpen': def<Entry[]>()(z.object({ query: z.string().max(200) })),
  'workspace.trash': def<TrashItem[]>()(None),
  'workspace.restore': def<Entry>()(z.object({ trashId: Id })),
  'workspace.emptyTrash': def<{ count: number }>()(None),
  'workspace.search': def<SearchHit[]>()(z.object({ query: z.string().min(1).max(200) })),
  'workspace.rescan': def<void>()(None),
  'workspace.showInFolder': def<void>()(z.object({ id: Id })),

  'notes.list': def<QuickNote[]>()(None),
  'notes.create': def<Entry>()(None),

  'documents.readText': def<TextDocument>()(z.object({ id: Id })),
  'documents.writeText': def<SaveResult>()(
    z.object({ id: Id, content: z.string().max(20_000_000), baseVersion: Version, force: z.boolean() })
  ),
  'documents.readDocx': def<DocxDocument>()(z.object({ id: Id })),
  'documents.writeDocx': def<SaveResult>()(
    z.object({ id: Id, doc: TiptapNodeSchema, baseVersion: Version, force: z.boolean() })
  ),
  'documents.pickImage': def<{ dataUrl: string; name: string } | null>()(None),
  // The renderer supplies the document as HTML; the main process asks where to save and
  // prints it with a neutral, theme-independent style. Returns null when the user cancels.
  'documents.exportPdf': def<{ path: string } | null>()(z.object({ id: Id, html: z.string().max(40_000_000) })),

  'slides.read': def<SlidesDocument>()(z.object({ id: Id })),
  'slides.write': def<SaveResult>()(z.object({ id: Id, presentation: PresentationSchema, baseVersion: Version, force: z.boolean() })),
  // The bytes of a PDF in the workspace, for the in-app slide viewer.
  'slides.readPdf': def<Uint8Array>()(z.object({ id: Id })),
  // Creates a new presentation next to a PDF: one slide per page, each page a picture the
  // renderer rasterized locally. The PDF itself is left untouched.
  'slides.fromPdf': def<Entry>()(
    z.object({
      id: Id,
      width: z.number().int().min(100).max(5000),
      height: z.number().int().min(100).max(5000),
      pages: z.array(SlideImageData).min(1).max(MAX_PDF_SLIDES)
    })
  ),

  'latex.toolchain': def<TexToolchain>()(None),
  'latex.project': def<LatexProject>()(z.object({ id: Id })),
  'latex.readFile': def<TextDocument>()(z.object({ id: Id, file: RelPath })),
  'latex.writeFile': def<SaveResult>()(
    z.object({
      id: Id,
      file: RelPath,
      content: z.string().max(20_000_000),
      baseVersion: Version,
      force: z.boolean()
    })
  ),
  'latex.createFile': def<void>()(z.object({ id: Id, file: RelPath })),
  'latex.deleteFile': def<void>()(z.object({ id: Id, file: RelPath })),
  'latex.compile': def<CompileResult>()(z.object({ id: Id })),
  'latex.readPdf': def<Uint8Array | null>()(z.object({ id: Id })),

  'flashcards.decks': def<Deck[]>()(None),
  'flashcards.createDeck': def<Deck>()(z.object({ name: z.string().trim().min(1).max(120), parentId: Id.nullable().optional() })),
  'flashcards.renameDeck': def<Deck>()(z.object({ id: Id, name: z.string().trim().min(1).max(120) })),
  'flashcards.moveDeck': def<Deck>()(z.object({ id: Id, parentId: Id.nullable() })),
  // 'subtree' deletes the deck and every subdeck; 'reparent' deletes only this deck and moves
  // its subdecks up to its parent.
  'flashcards.deleteDeck': def<void>()(z.object({ id: Id, mode: z.enum(['subtree', 'reparent']).default('subtree') })),
  'flashcards.cards': def<Card[]>()(z.object({ deckId: Id })),
  'flashcards.createCards': def<Card[]>()(
    z.object({
      deckId: Id,
      cards: z
        .array(z.object({ front: z.string().trim().min(1).max(4000), back: z.string().trim().min(1).max(8000) }))
        .min(1)
        .max(200),
      sourceEntryId: Id.nullable().optional(),
      sourceExcerpt: z.string().max(8000).nullable().optional()
    })
  ),
  'flashcards.updateCard': def<Card>()(
    z.object({
      id: Id,
      front: z.string().trim().min(1).max(8000),
      back: z.string().trim().min(1).max(8000),
      extra: z.string().max(8000).optional(),
      tags: z.string().max(500).optional()
    })
  ),
  'flashcards.deleteCard': def<void>()(z.object({ id: Id })),
  'flashcards.moveCards': def<void>()(z.object({ cardIds: z.array(Id).min(1).max(2000), deckId: Id })),
  // 'due' is the scheduled session (reviews due today plus the day's new cards). 'all' is every
  // card, for practising a deck that has nothing due; the renderer does not record ratings then.
  'flashcards.studyQueue': def<StudyCard[]>()(
    z.object({ deckId: Id.nullable(), includeSubdecks: z.boolean().default(true), mode: z.enum(['due', 'all']).default('due') })
  ),
  'flashcards.setDeckStyle': def<Deck>()(z.object({ id: Id, icon: z.enum(DECK_ICON_IDS), color: z.enum(DECK_COLOR_IDS) })),
  // Opens a native file picker for .csv / .tsv / .txt and returns the raw bytes for the
  // renderer to decode and preview. Nothing is imported until `flashcards.importCards`.
  'flashcards.importPick': def<{ name: string; bytes: Uint8Array } | null>()(None),
  'flashcards.importCards': def<ImportSummary>()(
    z.object({
      deckId: Id,
      duplicates: z.enum(['all', 'skip', 'update']),
      cards: z
        .array(
          z.object({
            front: z.string().min(1).max(8000),
            back: z.string().min(1).max(8000),
            extra: z.string().max(8000),
            tags: z.string().max(500)
          })
        )
        .min(1)
        .max(1000)
    })
  ),

  'pomodoro.get': def<PomodoroSnapshot>()(None),
  'pomodoro.saveState': def<void>()(z.object({ state: z.record(z.string(), z.unknown()) })),
  'pomodoro.saveSettings': def<PomodoroSnapshot>()(z.object({ settings: z.record(z.string(), z.unknown()) })),
  'pomodoro.logSession': def<PomodoroSnapshot>()(
    z.object({
      mode: z.enum(['focus', 'short', 'long']),
      startedAt: z.number().int().positive(),
      endedAt: z.number().int().positive(),
      plannedMs: z.number().int().positive().max(86_400_000),
      completed: z.boolean(),
      /** Show a Windows notification for this session's end. */
      notify: z.boolean()
    })
  ),
  'flashcards.rate': def<Card>()(z.object({ cardId: Id, rating: z.enum(['again', 'hard', 'good', 'easy']) })),
  'flashcards.summary': def<FlashcardSummary>()(None),

  'planner.tasks': def<Task[]>()(None),
  'planner.saveTask': def<Task>()(
    z.object({
      id: Id.optional(),
      title: z.string().trim().min(1).max(300),
      notes: z.string().max(10000),
      dueDate: DateStr.nullable(),
      dueTime: TimeStr.nullable(),
      reminder: z.object({ localDate: DateStr, localTime: TimeStr, recurrence: RecurrenceSchema }).nullable()
    })
  ),
  'planner.setCompleted': def<Task>()(z.object({ id: Id, completed: z.boolean() })),
  'planner.deleteTask': def<void>()(z.object({ id: Id })),
  'planner.reminders': def<Reminder[]>()(None),
  'planner.saveReminder': def<Reminder>()(
    z.object({
      id: Id.optional(),
      title: z.string().trim().min(1).max(300),
      localDate: DateStr,
      localTime: TimeStr,
      recurrence: RecurrenceSchema
    })
  ),
  'planner.deleteReminder': def<void>()(z.object({ id: Id })),
  'planner.acknowledgeReminder': def<void>()(z.object({ id: Id }))
} as const

export type Contract = typeof contract
export type Channel = keyof Contract
export type Req<K extends Channel> = z.input<Contract[K]['req']>
export type ParsedReq<K extends Channel> = z.output<Contract[K]['req']>
export type Res<K extends Channel> = Contract[K]['_res']

export const channelNames = Object.keys(contract) as Channel[]
export { EVENT_CHANNEL }

// The preload script takes its channel names from channels.ts. These two lines stop the build if
// a channel is added here but not there, or the other way round.
type Mismatch = Exclude<Channel, (typeof CHANNEL_NAMES)[number]> | Exclude<(typeof CHANNEL_NAMES)[number], Channel>
export const CHANNELS_IN_STEP: [Mismatch] extends [never] ? true : never = true
