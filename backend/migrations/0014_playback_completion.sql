CREATE TABLE `playback_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`context` text NOT NULL,
	`captured_at` integer NOT NULL,
	`attempted_at` integer DEFAULT 0 NOT NULL,
	`outcome` text NOT NULL,
	`decision` text,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `playback_coverage` (
	`source_id` text PRIMARY KEY NOT NULL,
	`duration_ms` integer NOT NULL,
	`intervals` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
