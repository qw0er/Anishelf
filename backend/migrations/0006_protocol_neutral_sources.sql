-- Retain old RSS identities and supply the private binding before changing the FK.
INSERT INTO acquisition_sources (id, binding, enabled, failures, snapshot)
SELECT id, json_object('kind', 'rss', 'url', url), 0, failures, NULL
FROM acquisition_feeds WHERE true
ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
UPDATE acquisition_sources
SET binding = json_object('kind', 'rss', 'url',
 (SELECT url FROM acquisition_feeds WHERE acquisition_feeds.id = acquisition_sources.id))
WHERE json_extract(binding, '$.kind') = 'rss'
 AND EXISTS (SELECT 1 FROM acquisition_feeds WHERE acquisition_feeds.id = acquisition_sources.id);
--> statement-breakpoint
-- Old registration rows could outlive the former Discovery-owned feed deletion.
DELETE FROM acquisition_sources
WHERE json_extract(binding, '$.kind') = 'rss'
 AND json_extract(binding, '$.url') IS NULL;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_acquisition_subscriptions` (
	`last_error` text,
	`last_error_present` integer NOT NULL,
	`work_key` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`start_episode` integer NOT NULL,
	`profile_id` text,
	`enabled` integer NOT NULL,
	`revision` text NOT NULL,
	FOREIGN KEY (`feed_id`) REFERENCES `acquisition_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "acquisition_subscriptions_last_error_present_0" CHECK("__new_acquisition_subscriptions"."last_error_present" IN (0, 1)),
	CONSTRAINT "acquisition_subscriptions_start_episode_0" CHECK("__new_acquisition_subscriptions"."start_episode" >= 1),
	CONSTRAINT "acquisition_subscriptions_enabled_0" CHECK("__new_acquisition_subscriptions"."enabled" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_acquisition_subscriptions`("last_error", "last_error_present", "work_key", "feed_id", "start_episode", "profile_id", "enabled", "revision") SELECT "last_error", "last_error_present", "work_key", "feed_id", "start_episode", "profile_id", "enabled", "revision" FROM `acquisition_subscriptions`;--> statement-breakpoint
DROP TABLE `acquisition_subscriptions`;--> statement-breakpoint
ALTER TABLE `__new_acquisition_subscriptions` RENAME TO `acquisition_subscriptions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `acquisition_subscriptions_feed` ON `acquisition_subscriptions` (`feed_id`);