CREATE TABLE `subtitle_font_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`set_id` text NOT NULL,
	`stream_index` integer NOT NULL,
	`format` text NOT NULL,
	`family` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`digest` text NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `subtitle_font_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "subtitle_font_stream" CHECK("subtitle_font_assets"."stream_index" >= 0),
	CONSTRAINT "subtitle_font_size" CHECK("subtitle_font_assets"."size_bytes" > 0),
	CONSTRAINT "subtitle_font_format" CHECK("subtitle_font_assets"."format" IN ('ttf', 'otf'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subtitle_font_attachment` ON `subtitle_font_assets` (`set_id`,`stream_index`);--> statement-breakpoint
CREATE TABLE `subtitle_font_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`status` text NOT NULL,
	`warnings` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "subtitle_font_set_status" CHECK("subtitle_font_sets"."status" IN ('pending', 'ready', 'degraded'))
);
--> statement-breakpoint
CREATE INDEX `subtitle_font_source` ON `subtitle_font_sets` (`source_id`);