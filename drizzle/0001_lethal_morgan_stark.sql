CREATE TABLE `mastery_state` (
	`concept_node_id` text PRIMARY KEY NOT NULL,
	`knowledge_score` real,
	`experience_score` real,
	`last_updated` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `practice_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`type` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`feedback` text NOT NULL,
	`reflection_notes` text,
	`date` text NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `quiz_results` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`tier` text NOT NULL,
	`score` real NOT NULL,
	`date` text NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action
);
