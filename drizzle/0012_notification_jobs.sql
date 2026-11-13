CREATE TABLE `notification_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`job` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`next_run_at` text NOT NULL,
	`failed_at` text
);
--> statement-breakpoint
CREATE INDEX `notification_jobs_next_run_idx` ON `notification_jobs` (`next_run_at`);