CREATE TABLE `auth_device_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_device_sessions_token_hash_unique` ON `auth_device_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_device_sessions_expiry` ON `auth_device_sessions` (`expires_at`);