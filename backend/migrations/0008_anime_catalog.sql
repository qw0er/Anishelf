CREATE TABLE `catalog_associations` (
	`source_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`raw_numbers` text NOT NULL,
	`reason` text NOT NULL,
	`operation_key` text NOT NULL,
	`offset` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`episode_id`) REFERENCES `catalog_episodes`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_source_episode` ON `catalog_associations` (`source_id`,`episode_id`);--> statement-breakpoint
CREATE INDEX `catalog_episode_sources` ON `catalog_associations` (`episode_id`);--> statement-breakpoint
CREATE TABLE `catalog_episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`kind` text NOT NULL,
	`number` text NOT NULL,
	`label` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `catalog_works`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_episode_identity` ON `catalog_episodes` (`work_id`,`kind`,`number`);--> statement-breakpoint
CREATE TABLE `catalog_operations` (
	`key` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`result` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `catalog_provider_links` (
	`work_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`media_type` text NOT NULL,
	`provider_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `catalog_works`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`snapshot_id`) REFERENCES `metadata_snapshots`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_provider_identity` ON `catalog_provider_links` (`provider`,`media_type`,`provider_id`);--> statement-breakpoint
CREATE TABLE `catalog_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`result` text NOT NULL,
	`available` integer NOT NULL,
	`revision` integer NOT NULL,
	`decision` text NOT NULL,
	`reason` text,
	FOREIGN KEY (`id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `catalog_works` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`aliases` text NOT NULL,
	`provider_title` text NOT NULL,
	`search_titles` text NOT NULL,
	`format` text,
	`year` integer,
	`episode_count` integer,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
