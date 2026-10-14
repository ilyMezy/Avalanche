CREATE TABLE `card_review` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`reviewed_at` integer NOT NULL,
	`rating` text NOT NULL,
	`prev_interval_days` integer NOT NULL,
	`new_interval_days` integer NOT NULL,
	`prev_ease_factor` real NOT NULL,
	`new_ease_factor` real NOT NULL,
	`was_new` integer DEFAULT false NOT NULL,
	`study_date` text NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_review_card` ON `card_review` (`card_id`);--> statement-breakpoint
CREATE INDEX `card_review_date` ON `card_review` (`study_date`);--> statement-breakpoint
CREATE TABLE `card` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`position` integer NOT NULL,
	`front` text NOT NULL,
	`back` text NOT NULL,
	`state` text DEFAULT 'new' NOT NULL,
	`repetitions` integer DEFAULT 0 NOT NULL,
	`interval_days` integer DEFAULT 0 NOT NULL,
	`ease_factor` real DEFAULT 2.5 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`due_date` text,
	`last_review_date` text,
	`source_entry_id` text,
	`source_path_snapshot` text,
	`source_excerpt` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `deck`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_entry_id`) REFERENCES `fs_entry`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `card_deck` ON `card` (`deck_id`);--> statement-breakpoint
CREATE INDEX `card_due` ON `card` (`due_date`);--> statement-breakpoint
CREATE TABLE `deck` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`new_per_day` integer DEFAULT 20 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fs_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_path` text NOT NULL,
	`name` text NOT NULL,
	`rel_path` text NOT NULL,
	`rel_path_folded` text NOT NULL,
	`kind` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`modified_at` integer NOT NULL,
	`indexed_at` integer NOT NULL,
	`is_favorite` integer DEFAULT false NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`last_opened_at` integer,
	`search_text` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fs_entry_workspace_path` ON `fs_entry` (`workspace_id`,`rel_path_folded`);--> statement-breakpoint
CREATE INDEX `fs_entry_parent` ON `fs_entry` (`workspace_id`,`parent_path`);--> statement-breakpoint
CREATE TABLE `reminder` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`title` text NOT NULL,
	`local_date` text NOT NULL,
	`local_time` text NOT NULL,
	`recurrence` text DEFAULT 'none' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`next_due_at` integer,
	`last_fired_at` integer,
	`missed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reminder_due` ON `reminder` (`enabled`,`next_due_at`);--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`due_date` text,
	`due_time` text,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`root_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_scanned_at` integer
);
