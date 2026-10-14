CREATE TABLE `doc_open` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`opened_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `fs_entry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `doc_open_entry` ON `doc_open` (`entry_id`,`opened_at`);--> statement-breakpoint
CREATE TABLE `pomodoro_session` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`planned_ms` integer NOT NULL,
	`completed` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pomodoro_session_ended` ON `pomodoro_session` (`ended_at`);--> statement-breakpoint
CREATE TABLE `trash_item` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`original_rel_path` text NOT NULL,
	`kind` text NOT NULL,
	`deleted_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trash_item_workspace` ON `trash_item` (`workspace_id`,`deleted_at`);--> statement-breakpoint
ALTER TABLE `card` ADD `extra` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `card` ADD `tags` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `deck` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `fs_entry` ADD `frequent_pinned` integer DEFAULT false NOT NULL;