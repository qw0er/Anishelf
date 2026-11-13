CREATE TABLE `__new_acquisition_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` text NOT NULL,
	`work_key` text NOT NULL,
	`candidate_id` text NOT NULL,
	`episode` integer NOT NULL,
	`title` text NOT NULL,
	`hash` text NOT NULL,
	`expected_hash` text,
	`source` text NOT NULL,
	`destination_revision` text NOT NULL,
	`destination_scope_id` text NOT NULL,
	`destination_path` text NOT NULL,
	`destination_connection_generation` text NOT NULL,
	`destination_validated` integer NOT NULL,
	`destination_visibility_verified` integer NOT NULL,
	`directory` text NOT NULL,
	`origin` text NOT NULL DEFAULT 'subscription' CHECK (origin IN ('subscription', 'one-off')),
	`one_off` text CHECK (one_off IS NULL OR json_valid(one_off)),
	`subscription_revision` text,
	`state` text NOT NULL,
	`transfer` text,
	`progress` real,
	`ingestion` text NOT NULL,
	`error` text,
	`attempts` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`observed_at` integer,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`source_identity_present` integer NOT NULL,
	`source_identity_scope_id` text,
	`source_identity_file_id` text,
	`source_identity_relative_path` text,
	`source_identity_source_version` text,
	`last_command_present` integer NOT NULL,
	`last_command_id` text,
	`last_command_kind` text,
	CONSTRAINT "__new_acquisition_intents_episode_0" CHECK("__new_acquisition_intents"."episode" >= 1),
	CONSTRAINT "__new_acquisition_intents_destination_validated_0" CHECK("__new_acquisition_intents"."destination_validated" IN (0, 1)),
	CONSTRAINT "__new_acquisition_intents_destination_visibility_verified_0" CHECK("__new_acquisition_intents"."destination_visibility_verified" IN (0, 1)),
	CONSTRAINT "__new_acquisition_intents_state_0" CHECK("__new_acquisition_intents"."state" IN ('discovering', 'pending', 'submitting', 'unknown', 'bound', 'blocked', 'missing', 'available')),
	CONSTRAINT "__new_acquisition_intents_progress_0" CHECK("__new_acquisition_intents"."progress" BETWEEN 0 AND 1),
	CONSTRAINT "__new_acquisition_intents_ingestion_0" CHECK("__new_acquisition_intents"."ingestion" IN ('not-ready', 'pending', 'validating', 'review', 'failed', 'available')),
	CONSTRAINT "__new_acquisition_intents_attempts_0" CHECK("__new_acquisition_intents"."attempts" >= 0),
	CONSTRAINT "__new_acquisition_intents_next_attempt_at_0" CHECK("__new_acquisition_intents"."next_attempt_at" >= 0),
	CONSTRAINT "__new_acquisition_intents_updated_at_0" CHECK("__new_acquisition_intents"."updated_at" >= 0),
	CONSTRAINT "__new_acquisition_intents_created_at_0" CHECK("__new_acquisition_intents"."created_at" >= 0),
	CONSTRAINT "__new_acquisition_intents_source_identity_present_0" CHECK("__new_acquisition_intents"."source_identity_present" IN (0, 1)),
	CONSTRAINT "__new_acquisition_intents_last_command_present_0" CHECK("__new_acquisition_intents"."last_command_present" IN (0, 1)),
	CONSTRAINT "__new_acquisition_intents_last_command_kind_0" CHECK("__new_acquisition_intents"."last_command_kind" IN ('acquisition', 'import'))
);
--> statement-breakpoint
INSERT INTO __new_acquisition_intents (`id`, `revision`, `work_key`, `candidate_id`, `episode`, `title`, `hash`, `expected_hash`, `source`, `destination_revision`, `destination_scope_id`, `destination_path`, `destination_connection_generation`, `destination_validated`, `destination_visibility_verified`, `directory`, `subscription_revision`, `state`, `transfer`, `progress`, `ingestion`, `error`, `attempts`, `next_attempt_at`, `observed_at`, `updated_at`, `created_at`, `source_identity_present`, `source_identity_scope_id`, `source_identity_file_id`, `source_identity_relative_path`, `source_identity_source_version`, `last_command_present`, `last_command_id`, `last_command_kind`) SELECT `id`, `revision`, `work_key`, `candidate_id`, `episode`, `title`, `hash`, `expected_hash`, `source`, `destination_revision`, `destination_scope_id`, `destination_path`, `destination_connection_generation`, `destination_validated`, `destination_visibility_verified`, `directory`, `subscription_revision`, `state`, `transfer`, `progress`, `ingestion`, `error`, `attempts`, `next_attempt_at`, `observed_at`, `updated_at`, `created_at`, `source_identity_present`, `source_identity_scope_id`, `source_identity_file_id`, `source_identity_relative_path`, `source_identity_source_version`, `last_command_present`, `last_command_id`, `last_command_kind` FROM acquisition_intents;
--> statement-breakpoint
DROP TABLE acquisition_intents;
--> statement-breakpoint
ALTER TABLE __new_acquisition_intents RENAME TO acquisition_intents;
--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_episode_reservation` ON `acquisition_intents` (`work_key`,`episode`);
--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_hash_reservation` ON `acquisition_intents` (`hash`);
--> statement-breakpoint
CREATE INDEX `acquisition_intents_work` ON `acquisition_intents` (`work_key`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `acquisition_intents_due` ON `acquisition_intents` (`state`,`next_attempt_at`,`id`);
