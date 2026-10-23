PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_acquisition_subscriptions` (
	`automatic` text,
	`created_by` text,
	`last_error` text,
	`last_error_present` integer NOT NULL,
	`work_key` text PRIMARY KEY NOT NULL,
	`feed_id` text,
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
INSERT INTO `__new_acquisition_subscriptions`("automatic", "created_by", "last_error", "last_error_present", "work_key", "feed_id", "source_input", "start_episode", "profile_id", "enabled", "revision") SELECT NULL, NULL, "last_error", "last_error_present", "work_key", "feed_id", "source_input", "start_episode", "profile_id", "enabled", "revision" FROM `acquisition_subscriptions`;--> statement-breakpoint
DROP TABLE `acquisition_subscriptions`;--> statement-breakpoint
ALTER TABLE `__new_acquisition_subscriptions` RENAME TO `acquisition_subscriptions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `acquisition_subscriptions_feed` ON `acquisition_subscriptions` (`feed_id`);
--> statement-breakpoint
-- Old managed grants governed ongoing enablement. Require explicit renewal before
-- converting them into independent subscriptions; submitted tasks remain intact.
UPDATE acquisition_subscriptions SET enabled = 0, created_by = 'watching', last_error = 'authorization_required', last_error_present = 1
WHERE work_key IN (SELECT work_key FROM acquisition_watching_members WHERE subscription_revision IS NOT NULL);
--> statement-breakpoint
DELETE FROM acquisition_authorizations WHERE work_key IN (SELECT work_key FROM acquisition_watching_members WHERE subscription_revision IS NOT NULL);
--> statement-breakpoint
UPDATE acquisition_watching_members SET subscription_revision = NULL, grant_id = NULL, paused = 0;
--> statement-breakpoint
UPDATE acquisition_watching_policy SET value = json_set(value, '$.enabled', json('false'), '$.grant', NULL, '$.revision', 'unified-subscriptions');
