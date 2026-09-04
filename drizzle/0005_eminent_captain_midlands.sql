CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`course_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`stated_goals` text NOT NULL,
	`last_goal_connection_shown_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
