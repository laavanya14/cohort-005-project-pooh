-- Rename `refunds` to `refund_requests` to match GLOSSARY.md. SQLite cannot
-- change a column default in place, so the table is rebuilt and its rows
-- copied across: `requested` becomes `open`, and `resolved_*` becomes
-- `decided_*` (a withdrawn request is closed but never decided).
CREATE TABLE `refund_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reason` text NOT NULL,
	`amount_refunded` integer,
	`requested_at` text NOT NULL,
	`decided_at` text,
	`decided_by_user_id` integer,
	`decision_note` text,
	`withdrawn_at` text,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `refund_requests` (`id`, `purchase_id`, `status`, `reason`, `amount_refunded`, `requested_at`, `decided_at`, `decided_by_user_id`)
SELECT `id`, `purchase_id`, CASE `status` WHEN 'requested' THEN 'open' ELSE `status` END, `reason`, `amount_refunded`, `requested_at`, `resolved_at`, `resolved_by_user_id`
FROM `refunds`;
--> statement-breakpoint
DROP TABLE `refunds`;
--> statement-breakpoint
CREATE INDEX `refund_requests_purchase_idx` ON `refund_requests` (`purchase_id`);
