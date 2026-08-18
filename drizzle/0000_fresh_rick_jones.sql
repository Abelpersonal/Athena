CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`topic` text NOT NULL,
	`created_at` text NOT NULL,
	`volatility_tier` text NOT NULL,
	`status` text DEFAULT 'building' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`estimated_duration` text NOT NULL,
	`layers` text NOT NULL,
	`source_refs` text NOT NULL,
	`audio_cache_ref` text,
	`source_status` text DEFAULT 'ok' NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `modules` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`order_index` integer NOT NULL,
	`prerequisite_of` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`type` text NOT NULL,
	`extracted_text` text NOT NULL,
	`credibility_score` real NOT NULL,
	`fetched_at` text NOT NULL
);
