CREATE TABLE `subtitle_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`track_id` text NOT NULL,
	`stream_index` integer NOT NULL,
	`processing_version` text NOT NULL,
	`format` text NOT NULL,
	`status` text NOT NULL,
	`size_bytes` integer,
	`error_code` text,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "subtitle_stream_index" CHECK("subtitle_assets"."stream_index" >= 0),
	CONSTRAINT "subtitle_asset_size" CHECK("subtitle_assets"."size_bytes" IS NULL OR "subtitle_assets"."size_bytes" >= 0),
	CONSTRAINT "subtitle_asset_state" CHECK("subtitle_assets"."status" IN ('pending', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subtitle_asset_identity` ON `subtitle_assets` (`source_id`,`track_id`,`format`,`processing_version`);