ALTER TABLE `acquisition_candidates` ADD `selection` text;--> statement-breakpoint
ALTER TABLE `acquisition_subscriptions` ADD `profile_id` text;--> statement-breakpoint
ALTER TABLE `acquisition_feeds_entries` ADD `seeders` integer;--> statement-breakpoint
ALTER TABLE `acquisition_feeds_entries` ADD `seeders_observed_at` integer;