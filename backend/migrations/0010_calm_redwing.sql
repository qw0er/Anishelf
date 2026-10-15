CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `media_access_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`source_version` text NOT NULL,
	`fingerprint` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_access_links_expiry` ON `media_access_links` (`expires_at`);