PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_acquisition_subscriptions` (
	`last_error` text,
	`last_error_present` integer NOT NULL,
	`work_key` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`source_input` text,
	`start_episode` integer NOT NULL,
	`profile_id` text,
	`enabled` integer NOT NULL,
	`revision` text NOT NULL,
	CONSTRAINT "acquisition_subscriptions_last_error_present_0" CHECK("__new_acquisition_subscriptions"."last_error_present" IN (0, 1)),
	CONSTRAINT "acquisition_subscriptions_start_episode_0" CHECK("__new_acquisition_subscriptions"."start_episode" >= 1),
	CONSTRAINT "acquisition_subscriptions_enabled_0" CHECK("__new_acquisition_subscriptions"."enabled" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_acquisition_subscriptions`("last_error", "last_error_present", "work_key", "feed_id", "source_input", "start_episode", "profile_id", "enabled", "revision") SELECT "last_error", "last_error_present", "work_key", "feed_id",
 (SELECT CASE json_extract(binding, '$.kind')
 WHEN 'rss' THEN json_object('kind', 'feed', 'url', json_extract(binding, '$.url'))
 WHEN 'jackett' THEN json_object('kind', 'search',
 'connectionRevision', json_extract(binding, '$.plan.generation'),
 'providerId', json_extract(binding, '$.plan.indexerId'),
 'titles', json(json_extract(binding, '$.plan.titles'))) END
 FROM acquisition_sources WHERE id = acquisition_subscriptions.feed_id),
 "start_episode", "profile_id", "enabled", "revision" FROM `acquisition_subscriptions`;--> statement-breakpoint
DROP TABLE `acquisition_subscriptions`;--> statement-breakpoint
ALTER TABLE `__new_acquisition_subscriptions` RENAME TO `acquisition_subscriptions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `acquisition_subscriptions_feed` ON `acquisition_subscriptions` (`feed_id`);