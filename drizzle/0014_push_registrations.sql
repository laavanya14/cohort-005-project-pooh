CREATE TABLE `push_registrations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token` text NOT NULL,
	`browser_label` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_registrations_token_unique` ON `push_registrations` (`token`);--> statement-breakpoint
CREATE INDEX `push_registrations_user_idx` ON `push_registrations` (`user_id`);