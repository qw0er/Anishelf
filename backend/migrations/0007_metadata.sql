CREATE TABLE `metadata_artwork` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_key` text NOT NULL,
	`url` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`accessed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `metadata_pins` (
	`snapshot_id` text NOT NULL,
	`owner_id` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `metadata_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_pin_owner` ON `metadata_pins` (`snapshot_id`,`owner_id`);--> statement-breakpoint
CREATE TABLE `metadata_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_key` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`raw` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accessed_at` integer NOT NULL,
	`failure` text
);
--> statement-breakpoint
CREATE INDEX `metadata_cache_key` ON `metadata_snapshots` (`cache_key`,"fetched_at" desc);--> statement-breakpoint
CREATE INDEX `metadata_lru` ON `metadata_snapshots` (`kind`,`accessed_at`);