CREATE TABLE `acquisition_episode_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`work_key` text NOT NULL,
	`episode` integer NOT NULL,
	`live` integer NOT NULL,
	`accepted_target` text,
	`transfer_id` text,
	`ingestion` text NOT NULL,
	`source_identity` text,
	FOREIGN KEY (`request_id`) REFERENCES `acquisition_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transfer_id`) REFERENCES `acquisition_transfers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "acquisition_claim_episode" CHECK("acquisition_episode_claims"."episode" >= 1),
	CONSTRAINT "acquisition_claim_live" CHECK("acquisition_episode_claims"."live" IN (0, 1)),
	CONSTRAINT "acquisition_claim_ingestion" CHECK("acquisition_episode_claims"."ingestion" IN ('not-ready', 'pending', 'validating', 'review', 'failed', 'available')),
	CONSTRAINT "acquisition_claim_evidence" CHECK(("acquisition_episode_claims"."accepted_target" IS NULL OR json_valid("acquisition_episode_claims"."accepted_target")) AND ("acquisition_episode_claims"."source_identity" IS NULL OR json_valid("acquisition_episode_claims"."source_identity")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_live_episode_claim` ON `acquisition_episode_claims` (`work_key`,`episode`) WHERE "acquisition_episode_claims"."live" = 1;--> statement-breakpoint
CREATE INDEX `acquisition_claims_work_episode` ON `acquisition_episode_claims` (`work_key`,`episode`);--> statement-breakpoint
CREATE INDEX `acquisition_claims_transfer` ON `acquisition_episode_claims` (`transfer_id`);--> statement-breakpoint
CREATE INDEX `acquisition_claims_request` ON `acquisition_episode_claims` (`request_id`);--> statement-breakpoint
CREATE TABLE `acquisition_request_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `acquisition_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `acquisition_commands_request` ON `acquisition_request_commands` (`request_id`);--> statement-breakpoint
CREATE TABLE `acquisition_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` text NOT NULL,
	`candidate_id` text NOT NULL,
	`title` text NOT NULL,
	`unresolved_hash` text,
	`expected_hash` text,
	`source` text NOT NULL,
	`destination_revision` text NOT NULL,
	`destination_scope_id` text NOT NULL,
	`destination_path` text NOT NULL,
	`destination_connection_generation` text NOT NULL,
	`destination_validated` integer NOT NULL,
	`destination_visibility_verified` integer NOT NULL,
	`directory` text NOT NULL,
	`origin` text NOT NULL,
	`one_off` text,
	`subscription_revision` text,
	`state` text NOT NULL,
	`error` text,
	`attempts` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_command_id` text,
	`last_command_kind` text,
	CONSTRAINT "acquisition_request_origin" CHECK("acquisition_requests"."origin" IN ('subscription', 'one-off')),
	CONSTRAINT "acquisition_request_one_off" CHECK("acquisition_requests"."one_off" IS NULL OR json_valid("acquisition_requests"."one_off")),
	CONSTRAINT "acquisition_request_state" CHECK("acquisition_requests"."state" IN ('discovering', 'pending', 'submitting', 'unknown', 'bound', 'blocked', 'missing', 'available')),
	CONSTRAINT "acquisition_request_destination_flags" CHECK("acquisition_requests"."destination_validated" IN (0, 1) AND "acquisition_requests"."destination_visibility_verified" IN (0, 1)),
	CONSTRAINT "acquisition_request_times" CHECK("acquisition_requests"."attempts" >= 0 AND "acquisition_requests"."next_attempt_at" >= 0 AND "acquisition_requests"."created_at" >= 0 AND "acquisition_requests"."updated_at" >= 0),
	CONSTRAINT "acquisition_request_last_command" CHECK(("acquisition_requests"."last_command_id" IS NULL AND "acquisition_requests"."last_command_kind" IS NULL) OR ("acquisition_requests"."last_command_id" IS NOT NULL AND "acquisition_requests"."last_command_kind" IS NOT NULL AND "acquisition_requests"."last_command_kind" IN ('acquisition', 'import')))
);
--> statement-breakpoint
CREATE INDEX `acquisition_requests_due` ON `acquisition_requests` (`state`,`next_attempt_at`,`id`);--> statement-breakpoint
CREATE TABLE `acquisition_transfer_file_targets` (
	`file_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`accepted_target` text,
	PRIMARY KEY(`file_id`, `claim_id`),
	FOREIGN KEY (`file_id`) REFERENCES `acquisition_transfer_files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`claim_id`) REFERENCES `acquisition_episode_claims`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "acquisition_file_target_evidence" CHECK("acquisition_transfer_file_targets"."accepted_target" IS NULL OR json_valid("acquisition_transfer_file_targets"."accepted_target"))
);
--> statement-breakpoint
CREATE INDEX `acquisition_file_targets_claim` ON `acquisition_transfer_file_targets` (`claim_id`);--> statement-breakpoint
CREATE TABLE `acquisition_transfer_files` (
	`id` text PRIMARY KEY NOT NULL,
	`transfer_id` text NOT NULL,
	`file_index` integer,
	`path` text NOT NULL,
	`size_bytes` integer,
	`role` text NOT NULL,
	`desired_selected` integer NOT NULL,
	`observed_selected` integer,
	`video_file_id` text,
	`source_identity` text,
	`ingestion` text NOT NULL,
	FOREIGN KEY (`transfer_id`) REFERENCES `acquisition_transfers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`video_file_id`) REFERENCES `acquisition_transfer_files`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "acquisition_file_path" CHECK(length("acquisition_transfer_files"."path") > 0),
	CONSTRAINT "acquisition_file_metadata" CHECK("acquisition_transfer_files"."file_index" >= 0 AND "acquisition_transfer_files"."size_bytes" >= 0),
	CONSTRAINT "acquisition_file_role" CHECK(("acquisition_transfer_files"."role" = 'video' AND "acquisition_transfer_files"."video_file_id" IS NULL) OR ("acquisition_transfer_files"."role" = 'subtitle' AND "acquisition_transfer_files"."video_file_id" IS NOT NULL)),
	CONSTRAINT "acquisition_file_flags" CHECK("acquisition_transfer_files"."desired_selected" IN (0, 1) AND ("acquisition_transfer_files"."observed_selected" IS NULL OR "acquisition_transfer_files"."observed_selected" IN (0, 1))),
	CONSTRAINT "acquisition_file_ingestion" CHECK("acquisition_transfer_files"."ingestion" IN ('not-ready', 'pending', 'validating', 'review', 'failed', 'available')),
	CONSTRAINT "acquisition_file_source_identity" CHECK("acquisition_transfer_files"."source_identity" IS NULL OR json_valid("acquisition_transfer_files"."source_identity"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_file_path_per_transfer` ON `acquisition_transfer_files` (`transfer_id`,`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_file_index_per_transfer` ON `acquisition_transfer_files` (`transfer_id`,`file_index`);--> statement-breakpoint
CREATE TABLE `acquisition_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`hash` text NOT NULL,
	`owned` integer NOT NULL,
	`source` text NOT NULL,
	`destination_revision` text NOT NULL,
	`destination_scope_id` text NOT NULL,
	`destination_path` text NOT NULL,
	`destination_connection_generation` text NOT NULL,
	`destination_validated` integer NOT NULL,
	`destination_visibility_verified` integer NOT NULL,
	`directory` text NOT NULL,
	`state` text,
	`progress` real,
	`observed_at` integer,
	`selection_mode` text DEFAULT 'all' NOT NULL,
	`selection_revision` text NOT NULL,
	`observed_selection` text,
	FOREIGN KEY (`request_id`) REFERENCES `acquisition_requests`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "acquisition_transfer_hash" CHECK(length("acquisition_transfers"."hash") = 40 AND "acquisition_transfers"."hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "acquisition_transfer_flags" CHECK("acquisition_transfers"."owned" IN (0, 1) AND "acquisition_transfers"."destination_validated" IN (0, 1) AND "acquisition_transfers"."destination_visibility_verified" IN (0, 1)),
	CONSTRAINT "acquisition_transfer_progress" CHECK("acquisition_transfers"."progress" BETWEEN 0 AND 1),
	CONSTRAINT "acquisition_transfer_selection_mode" CHECK("acquisition_transfers"."selection_mode" IN ('all', 'files')),
	CONSTRAINT "acquisition_transfer_observed_selection" CHECK("acquisition_transfers"."observed_selection" IS NULL OR json_valid("acquisition_transfers"."observed_selection"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_transfer_ownership` ON `acquisition_transfers` (`destination_connection_generation`,`hash`) WHERE "acquisition_transfers"."owned" = 1;--> statement-breakpoint
CREATE INDEX `acquisition_transfers_request` ON `acquisition_transfers` (`request_id`);--> statement-breakpoint
INSERT INTO acquisition_requests (
	id, revision, candidate_id, title, unresolved_hash, expected_hash, source,
	destination_revision, destination_scope_id, destination_path,
	destination_connection_generation, destination_validated,
	destination_visibility_verified, directory, origin, one_off, subscription_revision,
	state, error, attempts, next_attempt_at, updated_at, created_at,
	last_command_id, last_command_kind
)
SELECT
	id, revision, candidate_id, title,
	CASE WHEN length(hash) = 40 AND lower(hash) NOT GLOB '*[^0-9a-f]*' THEN NULL ELSE hash END,
	expected_hash, source, destination_revision, destination_scope_id, destination_path,
	destination_connection_generation, destination_validated,
	destination_visibility_verified, directory, origin, one_off, subscription_revision,
	state, error, attempts, next_attempt_at, updated_at, created_at,
	CASE WHEN last_command_present = 1 AND last_command_kind IS NOT NULL THEN last_command_id END,
	CASE WHEN last_command_present = 1 AND last_command_id IS NOT NULL THEN last_command_kind END
FROM acquisition_intents;
--> statement-breakpoint
INSERT INTO acquisition_transfers (
	id, request_id, owner_key, hash, owned, source, destination_revision,
	destination_scope_id, destination_path, destination_connection_generation,
	destination_validated, destination_visibility_verified, directory,
	state, progress, observed_at, selection_revision
)
SELECT
	id, id, id, lower(hash),
	CASE WHEN state = 'missing' OR (state = 'blocked' AND error IS NOT 'downloader_configuration_changed')
		THEN 0 ELSE 1 END,
	source, destination_revision, destination_scope_id, destination_path,
	destination_connection_generation, destination_validated,
	destination_visibility_verified, directory, transfer, progress, observed_at, revision
FROM acquisition_intents
WHERE length(hash) = 40 AND lower(hash) NOT GLOB '*[^0-9a-f]*';
--> statement-breakpoint
INSERT INTO acquisition_episode_claims (
	id, request_id, work_key, episode, live, accepted_target, transfer_id, ingestion, source_identity
)
SELECT
	intent.id, intent.id, intent.work_key, intent.episode,
	CASE WHEN intent.state IN ('available', 'missing') THEN 0
		WHEN intent.state = 'blocked'
			AND (intent.error IS NOT 'downloader_configuration_changed' OR transfer.id IS NULL) THEN 0
		ELSE 1 END,
	intent.accepted_target, transfer.id, intent.ingestion,
	CASE WHEN intent.source_identity_present = 1 THEN json_object(
		'scopeId', intent.source_identity_scope_id,
		'fileId', intent.source_identity_file_id,
		'relativePath', intent.source_identity_relative_path,
		'sourceVersion', intent.source_identity_source_version
	) END
FROM acquisition_intents AS intent
LEFT JOIN acquisition_transfers AS transfer ON transfer.id = intent.id;
--> statement-breakpoint
INSERT INTO acquisition_request_commands (id, request_id)
SELECT id, id FROM acquisition_intents WHERE origin = 'one-off';
--> statement-breakpoint
-- The old importer saved verified local identity. Its database did not record
-- the remote file index, byte size or observed selection.
WITH local_evidence AS (
	SELECT claim.id, claim.transfer_id, claim.source_identity, claim.ingestion, intent.directory,
		CASE WHEN substr(intent.destination_path, 2, 1) = ':'
			OR substr(intent.destination_path, 1, 2) = char(92) || char(92)
			THEN replace(intent.source_identity_relative_path, char(92), '/')
			ELSE intent.source_identity_relative_path END AS relative_path
	FROM acquisition_episode_claims AS claim
	JOIN acquisition_intents AS intent ON intent.id = claim.id
	WHERE claim.transfer_id IS NOT NULL AND claim.source_identity IS NOT NULL
		AND intent.source_identity_scope_id = intent.destination_scope_id
		AND length(intent.source_identity_file_id) > 0
		AND length(intent.source_identity_source_version) > 0
), verified AS (
	SELECT id, transfer_id, source_identity, ingestion,
		substr(relative_path, length(directory) + 2) AS path
	FROM local_evidence
	WHERE substr(relative_path, 1, length(directory) + 1) = directory || '/'
)
INSERT INTO acquisition_transfer_files (
	id, transfer_id, path, role, desired_selected, source_identity, ingestion
)
SELECT id, transfer_id, path, 'video', 1, source_identity, ingestion FROM verified
WHERE length(path) BETWEEN 1 AND 4096
	AND substr(path, 1, 1) <> '/' AND substr(path, -1) <> '/'
	AND instr(path, char(92)) = 0 AND instr(path, char(0)) = 0 AND instr(path, '//') = 0
	AND instr('/' || path || '/', '/../') = 0 AND instr('/' || path || '/', '/./') = 0;
--> statement-breakpoint
INSERT INTO acquisition_transfer_file_targets (file_id, claim_id, accepted_target)
SELECT file.id, claim.id, claim.accepted_target
FROM acquisition_transfer_files AS file
JOIN acquisition_episode_claims AS claim ON claim.id = file.id;
--> statement-breakpoint
SELECT anishelf_acquisition_backfilled(
	(SELECT count(*) FROM acquisition_episode_claims),
	(SELECT count(*) FROM acquisition_transfers),
	(SELECT count(*) FROM acquisition_transfer_files)
);
--> statement-breakpoint
DROP TABLE `acquisition_intents`;
