CREATE TABLE `mind_maps` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`graph_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mind_maps_course_id_unique` ON `mind_maps` (`course_id`);