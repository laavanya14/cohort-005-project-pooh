-- Store the glossary terms "platform admin" and "team admin" instead of "admin" on its own.
UPDATE `users` SET `role` = 'platform_admin' WHERE `role` = 'admin';--> statement-breakpoint
UPDATE `team_members` SET `role` = 'team_admin' WHERE `role` = 'admin';
