ALTER TABLE `tracking_connection` ADD `provider_key` text DEFAULT 'anilist' NOT NULL;--> statement-breakpoint
ALTER TABLE `tracking_operations` ADD `attempt_episode_baseline` text;--> statement-breakpoint
ALTER TABLE `tracking_operations` ADD `attempt_automatic` integer;