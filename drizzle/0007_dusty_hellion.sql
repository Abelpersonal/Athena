ALTER TABLE `practice_attempts` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `practice_attempts_idempotency_key_unique` ON `practice_attempts` (`idempotency_key`);--> statement-breakpoint
ALTER TABLE `quiz_results` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_results_idempotency_key_tier_idx` ON `quiz_results` (`idempotency_key`,`tier`);