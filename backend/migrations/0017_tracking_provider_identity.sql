PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tracking_commands` (
	`account_id` text NOT NULL,
	`command_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`revision` integer NOT NULL,
	PRIMARY KEY(`account_id`, `command_id`)
);
--> statement-breakpoint
INSERT INTO `__new_tracking_commands`("account_id", "command_id", "operation_id", "revision") SELECT "account_id", "command_id", "operation_id", "revision" FROM `tracking_commands`;--> statement-breakpoint
DROP TABLE `tracking_commands`;--> statement-breakpoint
ALTER TABLE `__new_tracking_commands` RENAME TO `tracking_commands`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_tracking_connection` (
	`id` integer PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`account_id` text,
	`account_name` text,
	`credential_id` text,
	`state` text NOT NULL,
	`checked_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_tracking_connection`("id", "generation", "account_id", "account_name", "credential_id", "state", "checked_at") SELECT "id", "generation", "account_id", "account_name", "credential_id", "state", "checked_at" FROM `tracking_connection`;--> statement-breakpoint
DROP TABLE `tracking_connection`;--> statement-breakpoint
ALTER TABLE `__new_tracking_connection` RENAME TO `tracking_connection`;--> statement-breakpoint
CREATE TABLE `__new_tracking_intent_versions` (
	`account_id` text NOT NULL,
	`media_id` text NOT NULL,
	`manual_version` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`account_id`, `media_id`)
);
--> statement-breakpoint
INSERT INTO `__new_tracking_intent_versions`("account_id", "media_id", "manual_version") SELECT "account_id", "media_id", "manual_version" FROM `tracking_intent_versions`;--> statement-breakpoint
DROP TABLE `tracking_intent_versions`;--> statement-breakpoint
ALTER TABLE `__new_tracking_intent_versions` RENAME TO `tracking_intent_versions`;--> statement-breakpoint
CREATE TABLE `__new_tracking_list_cache` (
	`invalidated` integer DEFAULT false NOT NULL,
	`account_id` text PRIMARY KEY NOT NULL,
	`fetched_at` integer NOT NULL,
	`entries` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tracking_list_cache`("invalidated", "account_id", "fetched_at", "entries") SELECT "invalidated", "account_id", "fetched_at", "entries" FROM `tracking_list_cache`;--> statement-breakpoint
DROP TABLE `tracking_list_cache`;--> statement-breakpoint
ALTER TABLE `__new_tracking_list_cache` RENAME TO `tracking_list_cache`;--> statement-breakpoint
CREATE TABLE `__new_tracking_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`media_id` text NOT NULL,
	`operation` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tracking_operations`("id", "account_id", "media_id", "operation") SELECT "id", "account_id", "media_id", "operation" FROM `tracking_operations`;--> statement-breakpoint
DROP TABLE `tracking_operations`;--> statement-breakpoint
ALTER TABLE `__new_tracking_operations` RENAME TO `tracking_operations`;--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_operations_account_media` ON `tracking_operations` (`account_id`,`media_id`);
--> statement-breakpoint
UPDATE tracking_connection SET account_id = 'anilist:' || account_id WHERE account_id IS NOT NULL;
--> statement-breakpoint
UPDATE tracking_list_cache SET account_id = 'anilist:' || account_id WHERE account_id IS NOT NULL;
--> statement-breakpoint
UPDATE tracking_operations SET account_id = 'anilist:' || account_id WHERE account_id IS NOT NULL;
--> statement-breakpoint
UPDATE tracking_intent_versions SET account_id = 'anilist:' || account_id WHERE account_id IS NOT NULL;
--> statement-breakpoint
UPDATE tracking_commands SET account_id = 'anilist:' || account_id WHERE account_id IS NOT NULL;
--> statement-breakpoint
UPDATE tracking_operations SET media_id = 'anilist:anime:' || media_id;
--> statement-breakpoint
UPDATE tracking_intent_versions SET media_id = 'anilist:anime:' || media_id;
--> statement-breakpoint
UPDATE tracking_operations SET operation = json_set(operation, '$.accountId', account_id, '$.mediaId', media_id);
--> statement-breakpoint
UPDATE tracking_operations SET operation = json_set(operation, '$.baseline.id', 'anilist:' || json_extract(operation, '$.baseline.id'), '$.baseline.status', CASE json_extract(operation, '$.baseline.status') WHEN 'CURRENT' THEN 'watching' WHEN 'PLANNING' THEN 'planned' WHEN 'COMPLETED' THEN 'completed' WHEN 'PAUSED' THEN 'paused' WHEN 'DROPPED' THEN 'dropped' WHEN 'REPEATING' THEN 'rewatching' ELSE json_extract(operation, '$.baseline.status') END, '$.baseline.updatedAt', json_extract(operation, '$.baseline.updatedAt') * 1000) WHERE json_type(operation, '$.baseline') = 'object';
--> statement-breakpoint
UPDATE tracking_operations SET operation = json_set(operation, '$.remote.id', 'anilist:' || json_extract(operation, '$.remote.id'), '$.remote.status', CASE json_extract(operation, '$.remote.status') WHEN 'CURRENT' THEN 'watching' WHEN 'PLANNING' THEN 'planned' WHEN 'COMPLETED' THEN 'completed' WHEN 'PAUSED' THEN 'paused' WHEN 'DROPPED' THEN 'dropped' WHEN 'REPEATING' THEN 'rewatching' ELSE json_extract(operation, '$.remote.status') END, '$.remote.updatedAt', json_extract(operation, '$.remote.updatedAt') * 1000) WHERE json_type(operation, '$.remote') = 'object';
--> statement-breakpoint
UPDATE tracking_operations SET operation = json_set(operation, '$.attempt.baseline.id', 'anilist:' || json_extract(operation, '$.attempt.baseline.id'), '$.attempt.baseline.status', CASE json_extract(operation, '$.attempt.baseline.status') WHEN 'CURRENT' THEN 'watching' WHEN 'PLANNING' THEN 'planned' WHEN 'COMPLETED' THEN 'completed' WHEN 'PAUSED' THEN 'paused' WHEN 'DROPPED' THEN 'dropped' WHEN 'REPEATING' THEN 'rewatching' ELSE json_extract(operation, '$.attempt.baseline.status') END, '$.attempt.baseline.updatedAt', json_extract(operation, '$.attempt.baseline.updatedAt') * 1000) WHERE json_type(operation, '$.attempt.baseline') = 'object';
--> statement-breakpoint
UPDATE tracking_operations SET operation = json_set(operation, '$.desired.status', CASE json_extract(operation, '$.desired.status') WHEN 'CURRENT' THEN 'watching' WHEN 'PLANNING' THEN 'planned' WHEN 'COMPLETED' THEN 'completed' WHEN 'PAUSED' THEN 'paused' WHEN 'DROPPED' THEN 'dropped' WHEN 'REPEATING' THEN 'rewatching' ELSE json_extract(operation, '$.desired.status') END) WHERE json_type(operation, '$.desired.status') = 'text';
--> statement-breakpoint
UPDATE tracking_operations SET operation = json_set(operation, '$.attempt.desired.status', CASE json_extract(operation, '$.attempt.desired.status') WHEN 'CURRENT' THEN 'watching' WHEN 'PLANNING' THEN 'planned' WHEN 'COMPLETED' THEN 'completed' WHEN 'PAUSED' THEN 'paused' WHEN 'DROPPED' THEN 'dropped' WHEN 'REPEATING' THEN 'rewatching' ELSE json_extract(operation, '$.attempt.desired.status') END) WHERE json_type(operation, '$.attempt.desired.status') = 'text';
--> statement-breakpoint
UPDATE tracking_operations SET operation = json_set(operation, '$.target.mediaId', 'anilist:anime:' || json_extract(operation, '$.target.mediaId')) WHERE json_type(operation, '$.target') = 'object';
--> statement-breakpoint
UPDATE tracking_list_cache SET entries = COALESCE((SELECT json_group_array(json(json_set(value,
 '$.id', 'anilist:' || json_extract(value, '$.id'),
 '$.mediaId', 'anilist:anime:' || json_extract(value, '$.mediaId'),
 '$.status', CASE json_extract(value, '$.status') WHEN 'CURRENT' THEN 'watching' WHEN 'PLANNING' THEN 'planned' WHEN 'COMPLETED' THEN 'completed' WHEN 'PAUSED' THEN 'paused' WHEN 'DROPPED' THEN 'dropped' WHEN 'REPEATING' THEN 'rewatching' ELSE json_extract(value, '$.status') END, '$.updatedAt', json_extract(value, '$.updatedAt') * 1000))) FROM json_each(entries)), '[]');
--> statement-breakpoint
UPDATE playback_completions SET context = json_set(context, '$.version', 2,
 '$.accountId', 'anilist:' || json_extract(context, '$.accountId'),
 '$.mediaId', 'anilist:anime:' || json_extract(context, '$.mediaId'))
 WHERE CASE WHEN json_valid(context) THEN json_type(context, '$.version') IS NULL
 AND json_type(context, '$.accountId') = 'integer' AND json_type(context, '$.mediaId') = 'integer'
 AND json_type(context, '$.manualVersion') = 'integer' ELSE 0 END;
--> statement-breakpoint
UPDATE playback_completions SET outcome = json_object('state', 'ignored', 'reason', 'unsupported-observation-version')
 WHERE CASE WHEN json_valid(context) THEN COALESCE(json_extract(context, '$.version'), 0) <> 2 ELSE 1 END
 AND json_extract(outcome, '$.state') IN ('pending', 'unavailable');
