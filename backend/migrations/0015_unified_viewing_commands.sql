CREATE TABLE `tracking_commands` (
	`account_id` integer NOT NULL,
	`command_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`revision` integer NOT NULL,
	PRIMARY KEY(`account_id`, `command_id`)
);
--> statement-breakpoint
CREATE TABLE `tracking_intent_versions` (
	`account_id` integer NOT NULL,
	`media_id` integer NOT NULL,
	`manual_version` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`account_id`, `media_id`)
);
--> statement-breakpoint
DROP TABLE `playback_coverage`;--> statement-breakpoint
ALTER TABLE `playback_completions` DROP COLUMN `captured_at`;--> statement-breakpoint
ALTER TABLE `playback_completions` DROP COLUMN `decision`;
--> statement-breakpoint
UPDATE tracking_operations SET operation = json_remove(json_set(operation,
 '$.origin', CASE WHEN json_extract(operation, '$.completion') = 1 THEN 'automatic' ELSE 'manual-detail' END,
 '$.commandId', id, '$.intentAt', json_extract(operation, '$.updatedAt'),
 '$.target', NULL, '$.decisionReason', NULL), '$.completion');
--> statement-breakpoint
INSERT INTO tracking_commands (account_id, command_id, operation_id, revision)
 SELECT account_id, id, id, json_extract(operation, '$.revision') FROM tracking_operations;
--> statement-breakpoint
INSERT INTO tracking_intent_versions (account_id, media_id, manual_version)
 SELECT account_id, media_id, CASE WHEN json_extract(operation, '$.origin') = 'automatic' THEN 0 ELSE 1 END FROM tracking_operations;
--> statement-breakpoint
-- Legacy observations lack an intent version. End their delivery explicitly; preserve all admitted Tracking operations.
UPDATE playback_completions SET outcome = json_object('state', 'ignored', 'reason', 'legacy-observation-requires-replay');
