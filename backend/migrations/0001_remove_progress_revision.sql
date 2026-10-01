PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_playback_progress` (
	`source_id` text PRIMARY KEY NOT NULL,
	`position_ms` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`last_viewed_at_ms` integer,
	`generation` integer DEFAULT 1 NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "progress_position" CHECK("__new_playback_progress"."position_ms" >= 0),
	CONSTRAINT "progress_duration" CHECK("__new_playback_progress"."duration_ms" IS NULL OR ("__new_playback_progress"."duration_ms" > 0 AND "__new_playback_progress"."position_ms" <= "__new_playback_progress"."duration_ms")),
	CONSTRAINT "progress_generation" CHECK("__new_playback_progress"."generation" >= 1),
	CONSTRAINT "progress_sequence" CHECK("__new_playback_progress"."last_sequence" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_playback_progress`("source_id", "position_ms", "duration_ms", "last_viewed_at_ms", "generation", "last_sequence") SELECT "source_id", "position_ms", "duration_ms", "last_viewed_at_ms", "generation", "last_sequence" FROM `playback_progress`;--> statement-breakpoint
DROP TABLE `playback_progress`;--> statement-breakpoint
ALTER TABLE `__new_playback_progress` RENAME TO `playback_progress`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `progress_recent` ON `playback_progress` ("last_viewed_at_ms" desc,`source_id`);