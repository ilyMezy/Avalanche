import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Conventions (spec 13.2): primary keys are UUIDv7 text; `*_at` columns are integer
// milliseconds since the Unix epoch (UTC); `*_date` columns are local `YYYY-MM-DD` text.
// Document content is never stored here: `fs_entry` only indexes files that live on disk.

export const workspaces = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  rootPath: text('root_path').notNull(),
  createdAt: integer('created_at').notNull(),
  lastScannedAt: integer('last_scanned_at')
})

export const entries = sqliteTable(
  'fs_entry',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    parentPath: text('parent_path').notNull(),
    name: text('name').notNull(),
    relPath: text('rel_path').notNull(),
    relPathFolded: text('rel_path_folded').notNull(),
    kind: text('kind').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    modifiedAt: integer('modified_at').notNull(),
    indexedAt: integer('indexed_at').notNull(),
    isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
    isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
    lastOpenedAt: integer('last_opened_at'),
    /** Kept at the top of the sidebar's Frequent list regardless of how often it is opened. */
    frequentPinned: integer('frequent_pinned', { mode: 'boolean' }).notNull().default(false),
    /** Extracted plain text used for content search. Rebuildable from the file. */
    searchText: text('search_text').notNull().default('')
  },
  (t) => [
    uniqueIndex('fs_entry_workspace_path').on(t.workspaceId, t.relPathFolded),
    index('fs_entry_parent').on(t.workspaceId, t.parentPath)
  ]
)

export const settings = sqliteTable('setting', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull()
})

/** One row per time a document was opened; the Frequent list is ranked from these events. */
export const docOpens = sqliteTable(
  'doc_open',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    openedAt: integer('opened_at').notNull()
  },
  (t) => [index('doc_open_entry').on(t.entryId, t.openedAt)]
)

/** Items deleted in the app. The files live in the workspace's hidden trash folder until restored or emptied. */
export const trashItems = sqliteTable(
  'trash_item',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    originalRelPath: text('original_rel_path').notNull(),
    kind: text('kind').notNull(),
    deletedAt: integer('deleted_at').notNull()
  },
  (t) => [index('trash_item_workspace').on(t.workspaceId, t.deletedAt)]
)

export const pomodoroSessions = sqliteTable(
  'pomodoro_session',
  {
    id: text('id').primaryKey(),
    mode: text('mode').notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at').notNull(),
    plannedMs: integer('planned_ms').notNull(),
    /** False when the session was skipped or reset before its planned end. */
    completed: integer('completed', { mode: 'boolean' }).notNull()
  },
  (t) => [index('pomodoro_session_ended').on(t.endedAt)]
)

export const decks = sqliteTable('deck', {
  id: text('id').primaryKey(),
  /** Parent deck for subdecks; null for a top-level deck. A real tree, not a naming convention. */
  parentId: text('parent_id'),
  name: text('name').notNull(),
  /** Icon and colour identifiers from shared/domain/deck-style.ts. */
  icon: text('icon').notNull().default('layers'),
  color: text('color').notNull().default('default'),
  newPerDay: integer('new_per_day').notNull().default(20),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const cards = sqliteTable(
  'card',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    front: text('front').notNull(),
    back: text('back').notNull(),
    /** Optional extra information shown under the answer. */
    extra: text('extra').notNull().default(''),
    /** Space-separated tags. */
    tags: text('tags').notNull().default(''),
    state: text('state').notNull().default('new'),
    repetitions: integer('repetitions').notNull().default(0),
    intervalDays: integer('interval_days').notNull().default(0),
    easeFactor: real('ease_factor').notNull().default(2.5),
    lapses: integer('lapses').notNull().default(0),
    dueDate: text('due_date'),
    lastReviewDate: text('last_review_date'),
    sourceEntryId: text('source_entry_id').references(() => entries.id, { onDelete: 'set null' }),
    sourcePathSnapshot: text('source_path_snapshot'),
    sourceExcerpt: text('source_excerpt'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [index('card_deck').on(t.deckId), index('card_due').on(t.dueDate)]
)

/** Append-only review log: one row per rating, never rewritten. */
export const cardReviews = sqliteTable(
  'card_review',
  {
    id: text('id').primaryKey(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    reviewedAt: integer('reviewed_at').notNull(),
    rating: text('rating').notNull(),
    prevIntervalDays: integer('prev_interval_days').notNull(),
    newIntervalDays: integer('new_interval_days').notNull(),
    prevEaseFactor: real('prev_ease_factor').notNull(),
    newEaseFactor: real('new_ease_factor').notNull(),
    wasNew: integer('was_new', { mode: 'boolean' }).notNull().default(false),
    studyDate: text('study_date').notNull()
  },
  (t) => [index('card_review_card').on(t.cardId), index('card_review_date').on(t.studyDate)]
)

export const tasks = sqliteTable('task', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  notes: text('notes').notNull().default(''),
  dueDate: text('due_date'),
  dueTime: text('due_time'),
  completedAt: integer('completed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const reminders = sqliteTable(
  'reminder',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    localDate: text('local_date').notNull(),
    localTime: text('local_time').notNull(),
    recurrence: text('recurrence').notNull().default('none'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    nextDueAt: integer('next_due_at'),
    lastFiredAt: integer('last_fired_at'),
    missed: integer('missed', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [index('reminder_due').on(t.enabled, t.nextDueAt)]
)
