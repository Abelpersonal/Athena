CREATE TABLE `path_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`path_id` text NOT NULL,
	`name` text NOT NULL,
	`order_index` integer NOT NULL,
	FOREIGN KEY (`path_id`) REFERENCES `paths`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `path_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`path_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`topic_name` text NOT NULL,
	`description` text NOT NULL,
	`order_index` integer NOT NULL,
	`parallel_group` text NOT NULL,
	`course_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`path_id`) REFERENCES `paths`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`domain_id`) REFERENCES `path_domains`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `paths` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_description` text NOT NULL,
	`created_at` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `courses` ADD `goal_context` text;