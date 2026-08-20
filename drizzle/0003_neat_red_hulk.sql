CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`related_topic_id` text NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`category` text NOT NULL,
	`open_library_work_id` text,
	`gutenberg_url` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`related_topic_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lesson_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`update_event_id` text NOT NULL,
	`title` text NOT NULL,
	`what_changed` text NOT NULL,
	`updated_guidance` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`update_event_id`) REFERENCES `update_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `update_events` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`detected_at` text NOT NULL,
	`severity` text NOT NULL,
	`delta_summary` text NOT NULL,
	`superseded_fact_ref` text,
	FOREIGN KEY (`topic_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `courses` ADD `completed_at` text;--> statement-breakpoint
ALTER TABLE `courses` ADD `last_checked` text;