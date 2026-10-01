CREATE TABLE `media_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`root_id` text NOT NULL,
	`file_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`source_version` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`root_id`) REFERENCES `resource_roots`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_sources_identity` ON `media_sources` (`root_id`,`file_id`,`source_version`);--> statement-breakpoint
CREATE INDEX `media_sources_root` ON `media_sources` (`root_id`,`id`);--> statement-breakpoint
CREATE TABLE `playback_progress` (
	`source_id` text PRIMARY KEY NOT NULL,
	`position_ms` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`last_viewed_at_ms` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "progress_position" CHECK("playback_progress"."position_ms" >= 0),
	CONSTRAINT "progress_duration" CHECK("playback_progress"."duration_ms" IS NULL OR ("playback_progress"."duration_ms" > 0 AND "playback_progress"."position_ms" <= "playback_progress"."duration_ms")),
	CONSTRAINT "progress_revision" CHECK("playback_progress"."revision" >= 0),
	CONSTRAINT "progress_generation" CHECK("playback_progress"."generation" >= 1),
	CONSTRAINT "progress_sequence" CHECK("playback_progress"."last_sequence" >= 0)
);
--> statement-breakpoint
CREATE INDEX `progress_recent` ON `playback_progress` ("last_viewed_at_ms" desc,`source_id`);--> statement-breakpoint
CREATE TABLE `resource_roots` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_path` text NOT NULL,
	`created_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_roots_canonical_path_unique` ON `resource_roots` (`canonical_path`);