CREATE TABLE `acquisition_authorizations` (
	`work_key` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`start_episode` integer NOT NULL,
	`destination_revision` text NOT NULL,
	`connection_generation` text NOT NULL,
	CONSTRAINT "acquisition_authorizations_start_episode_0" CHECK("acquisition_authorizations"."start_episode" >= 1)
);

--> statement-breakpoint
CREATE TABLE `acquisition_candidates` (
	`chosen` integer,
	`id` text PRIMARY KEY NOT NULL,
	`work_key` text NOT NULL,
	`entry_id` text NOT NULL,
	`title` text NOT NULL,
	`episode` integer,
	`status` text NOT NULL,
	`version` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`work_key`) REFERENCES `acquisition_subscriptions`(`work_key`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "acquisition_candidates_chosen_0" CHECK("acquisition_candidates"."chosen" IN (0, 1)),
	CONSTRAINT "acquisition_candidates_status_0" CHECK("acquisition_candidates"."status" IN ('selected', 'skipped'))
);

--> statement-breakpoint
CREATE INDEX `acquisition_candidates_work` ON `acquisition_candidates` (`work_key`);
--> statement-breakpoint
CREATE TABLE `acquisition_candidates_reasons` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `acquisition_candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "acquisition_candidates_reasons_ordinal" CHECK("acquisition_candidates_reasons"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_candidates_reasons_order` ON `acquisition_candidates_reasons` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `acquisition_destination` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` text NOT NULL,
	`scope_id` text NOT NULL,
	`path` text NOT NULL,
	`connection_generation` text NOT NULL,
	`validated` integer NOT NULL,
	`visibility_verified` integer NOT NULL,
	CONSTRAINT "acquisition_destination_validated_0" CHECK("acquisition_destination"."validated" IN (0, 1)),
	CONSTRAINT "acquisition_destination_visibility_verified_0" CHECK("acquisition_destination"."visibility_verified" IN (0, 1)),
	CONSTRAINT "acquisition_destination_singleton" CHECK("acquisition_destination"."id" = 'default')
);

--> statement-breakpoint
CREATE TABLE `acquisition_directories` (
	`work_key` text PRIMARY KEY NOT NULL,
	`directory` text NOT NULL
);

--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_directories_directory_unique` ON `acquisition_directories` (`directory`);
--> statement-breakpoint
CREATE TABLE `acquisition_feeds` (
	`revision` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`etag` text,
	`last_modified` text,
	`checked_at` integer,
	`next_attempt_at` integer NOT NULL,
	`failures` integer NOT NULL,
	`error` text,
	CONSTRAINT "acquisition_feeds_next_attempt_at_0" CHECK("acquisition_feeds"."next_attempt_at" >= 0),
	CONSTRAINT "acquisition_feeds_failures_0" CHECK("acquisition_feeds"."failures" >= 0)
);

--> statement-breakpoint
CREATE TABLE `acquisition_feeds_entries` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`id` text NOT NULL,
	`observation_id` text NOT NULL,
	`title` text NOT NULL,
	`published_at` integer,
	`download_url` text,
	`hash` text,
	FOREIGN KEY (`parent_id`) REFERENCES `acquisition_feeds`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "acquisition_feeds_entries_ordinal" CHECK("acquisition_feeds_entries"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_feeds_entries_order` ON `acquisition_feeds_entries` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `acquisition_intents` (
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
	`subscription_revision` text NOT NULL,
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
	CONSTRAINT "acquisition_intents_episode_0" CHECK("acquisition_intents"."episode" >= 1),
	CONSTRAINT "acquisition_intents_destination_validated_0" CHECK("acquisition_intents"."destination_validated" IN (0, 1)),
	CONSTRAINT "acquisition_intents_destination_visibility_verified_0" CHECK("acquisition_intents"."destination_visibility_verified" IN (0, 1)),
	CONSTRAINT "acquisition_intents_state_0" CHECK("acquisition_intents"."state" IN ('pending', 'submitting', 'unknown', 'bound', 'blocked', 'missing', 'available')),
	CONSTRAINT "acquisition_intents_progress_0" CHECK("acquisition_intents"."progress" BETWEEN 0 AND 1),
	CONSTRAINT "acquisition_intents_ingestion_0" CHECK("acquisition_intents"."ingestion" IN ('not-ready', 'pending', 'validating', 'review', 'failed', 'available')),
	CONSTRAINT "acquisition_intents_attempts_0" CHECK("acquisition_intents"."attempts" >= 0),
	CONSTRAINT "acquisition_intents_next_attempt_at_0" CHECK("acquisition_intents"."next_attempt_at" >= 0),
	CONSTRAINT "acquisition_intents_updated_at_0" CHECK("acquisition_intents"."updated_at" >= 0),
	CONSTRAINT "acquisition_intents_created_at_0" CHECK("acquisition_intents"."created_at" >= 0),
	CONSTRAINT "acquisition_intents_source_identity_present_0" CHECK("acquisition_intents"."source_identity_present" IN (0, 1)),
	CONSTRAINT "acquisition_intents_last_command_present_0" CHECK("acquisition_intents"."last_command_present" IN (0, 1)),
	CONSTRAINT "acquisition_intents_last_command_kind_0" CHECK("acquisition_intents"."last_command_kind" IN ('acquisition', 'import'))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_episode_reservation` ON `acquisition_intents` (`work_key`,`episode`);
--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_hash_reservation` ON `acquisition_intents` (`hash`);
--> statement-breakpoint
CREATE INDEX `acquisition_intents_work` ON `acquisition_intents` (`work_key`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `acquisition_intents_due` ON `acquisition_intents` (`state`,`next_attempt_at`,`id`);
--> statement-breakpoint
CREATE TABLE `acquisition_subscriptions` (
	`last_error` text,
	`last_error_present` integer NOT NULL,
	`work_key` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`start_episode` integer NOT NULL,
	`enabled` integer NOT NULL,
	`revision` text NOT NULL,
	FOREIGN KEY (`feed_id`) REFERENCES `acquisition_feeds`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "acquisition_subscriptions_last_error_present_0" CHECK("acquisition_subscriptions"."last_error_present" IN (0, 1)),
	CONSTRAINT "acquisition_subscriptions_start_episode_0" CHECK("acquisition_subscriptions"."start_episode" >= 1),
	CONSTRAINT "acquisition_subscriptions_enabled_0" CHECK("acquisition_subscriptions"."enabled" IN (0, 1))
);

--> statement-breakpoint
CREATE INDEX `acquisition_subscriptions_feed` ON `acquisition_subscriptions` (`feed_id`);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`auth_fingerprint` text,
	`auth_expires_at` integer,
	`csrf_token` text,
	`cookie_expires` text,
	`cookie_original_max_age` integer,
	`cookie_original_expires` text,
	`cookie_same_site` text,
	`cookie_secure` integer,
	`cookie_path` text NOT NULL,
	`cookie_http_only` integer NOT NULL,
	`cookie_domain` text,
	`cookie_partitioned` integer,
	CONSTRAINT "auth_sessions_cookie_secure_0" CHECK("auth_sessions"."cookie_secure" IN (0, 1)),
	CONSTRAINT "auth_sessions_cookie_http_only_0" CHECK("auth_sessions"."cookie_http_only" IN (0, 1)),
	CONSTRAINT "auth_sessions_cookie_partitioned_0" CHECK("auth_sessions"."cookie_partitioned" IN (0, 1))
);

--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry` ON `auth_sessions` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `catalog_associations` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`reason` text NOT NULL,
	`operation_key` text NOT NULL,
	`offset` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`episode_id`) REFERENCES `catalog_episodes`(`id`) ON UPDATE no action ON DELETE restrict
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_source_episode` ON `catalog_associations` (`source_id`,`episode_id`);
--> statement-breakpoint
CREATE INDEX `catalog_episode_sources` ON `catalog_associations` (`episode_id`);
--> statement-breakpoint
CREATE TABLE `catalog_associations_raw_numbers` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_associations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_associations_raw_numbers_ordinal" CHECK("catalog_associations_raw_numbers"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_associations_raw_numbers_order` ON `catalog_associations_raw_numbers` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`kind` text NOT NULL,
	`number` text NOT NULL,
	`label` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `catalog_works`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "catalog_episode_kind" CHECK("catalog_episodes"."kind" IN ('regular', 'special', 'movie')),
	CONSTRAINT "catalog_episode_provenance" CHECK("catalog_episodes"."provenance" IN ('confirmed', 'count-derived'))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_episode_identity` ON `catalog_episodes` (`work_id`,`kind`,`number`);
--> statement-breakpoint
CREATE TABLE `catalog_operations` (
	`key` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`result_work_id` text NOT NULL,
	`result_revision` integer NOT NULL,
	CONSTRAINT "catalog_operations_result_revision_0" CHECK("catalog_operations"."result_revision" >= 0)
);

--> statement-breakpoint
CREATE TABLE `catalog_operations_result_review_ids` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_operations`(`key`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_operations_result_review_ids_ordinal" CHECK("catalog_operations_result_review_ids"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_operations_result_review_ids_order` ON `catalog_operations_result_review_ids` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_provider_links` (
	`work_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`media_type` text NOT NULL,
	`provider_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `catalog_works`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`snapshot_id`) REFERENCES `metadata_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "catalog_provider_media_type" CHECK("catalog_provider_links"."media_type" = 'anime')
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_provider_identity` ON `catalog_provider_links` (`provider`,`media_type`,`provider_id`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`available` integer NOT NULL,
	`revision` integer NOT NULL,
	`decision` text NOT NULL,
	`reason` text,
	`result_evidence_parser` text NOT NULL,
	`result_evidence_parser_version` text NOT NULL,
	`result_evidence_normalization_version` text NOT NULL,
	`result_evidence_context_fingerprint` text NOT NULL,
	`result_evidence_original_name` text NOT NULL,
	`result_evidence_relative_path` text NOT NULL,
	`result_evidence_title_sources_present` integer NOT NULL,
	`result_evidence_selected_episodes_present` integer NOT NULL,
	`result_evidence_numbering` text NOT NULL,
	`result_evidence_content_kind` text NOT NULL,
	`result_status` text NOT NULL,
	`result_metadata_status` text NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "catalog_reviews_available_0" CHECK("catalog_reviews"."available" IN (0, 1)),
	CONSTRAINT "catalog_reviews_revision_0" CHECK("catalog_reviews"."revision" >= 0),
	CONSTRAINT "catalog_reviews_decision_0" CHECK("catalog_reviews"."decision" IN ('pending', 'confirmed', 'rejected')),
	CONSTRAINT "catalog_reviews_result_evidence_title_sources_present_0" CHECK("catalog_reviews"."result_evidence_title_sources_present" IN (0, 1)),
	CONSTRAINT "catalog_reviews_result_evidence_selected_episodes_present_0" CHECK("catalog_reviews"."result_evidence_selected_episodes_present" IN (0, 1)),
	CONSTRAINT "catalog_reviews_result_evidence_numbering_0" CHECK("catalog_reviews"."result_evidence_numbering" IN ('single', 'range', 'ambiguous', 'unknown')),
	CONSTRAINT "catalog_reviews_result_evidence_content_kind_0" CHECK("catalog_reviews"."result_evidence_content_kind" IN ('regular', 'special', 'ancillary', 'unknown')),
	CONSTRAINT "catalog_reviews_result_status_0" CHECK("catalog_reviews"."result_status" IN ('parsed', 'proposed', 'unresolved')),
	CONSTRAINT "catalog_reviews_result_metadata_status_0" CHECK("catalog_reviews"."result_metadata_status" IN ('not-configured', 'searched', 'failed'))
);

--> statement-breakpoint
CREATE INDEX `catalog_reviews_decision` ON `catalog_reviews` (`decision`,`id`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_evidence_inputs` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`mode` text NOT NULL,
	`input` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_evidence_inputs_ordinal" CHECK("catalog_reviews_result_evidence_inputs"."ordinal_index" >= 0),
	CONSTRAINT "catalog_reviews_result_evidence_inputs_mode_0" CHECK("catalog_reviews_result_evidence_inputs"."mode" IN ('basename', 'ancestor', 'path', 'together'))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_evidence_inputs_order` ON `catalog_reviews_result_evidence_inputs` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_evidence_inputs_elements` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews_result_evidence_inputs`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_evidence_inputs_elements_ordinal" CHECK("catalog_reviews_result_evidence_inputs_elements"."ordinal_index" >= 0),
	CONSTRAINT "catalog_reviews_result_evidence_inputs_elements_position_0" CHECK("catalog_reviews_result_evidence_inputs_elements"."position" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_evidence_inputs_elements_order` ON `catalog_reviews_result_evidence_inputs_elements` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_evidence_parts` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_evidence_parts_ordinal" CHECK("catalog_reviews_result_evidence_parts"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_evidence_parts_order` ON `catalog_reviews_result_evidence_parts` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_evidence_raw_episodes` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_evidence_raw_episodes_ordinal" CHECK("catalog_reviews_result_evidence_raw_episodes"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_evidence_raw_episodes_order` ON `catalog_reviews_result_evidence_raw_episodes` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_evidence_seasons` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_evidence_seasons_ordinal" CHECK("catalog_reviews_result_evidence_seasons"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_evidence_seasons_order` ON `catalog_reviews_result_evidence_seasons` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_evidence_selected_episodes` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_evidence_selected_episodes_ordinal" CHECK("catalog_reviews_result_evidence_selected_episodes"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_evidence_selected_episodes_order` ON `catalog_reviews_result_evidence_selected_episodes` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_evidence_title_sources` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`title` text NOT NULL,
	`mode` text NOT NULL,
	`distance` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_evidence_title_sources_ordinal" CHECK("catalog_reviews_result_evidence_title_sources"."ordinal_index" >= 0),
	CONSTRAINT "catalog_reviews_result_evidence_title_sources_mode_0" CHECK("catalog_reviews_result_evidence_title_sources"."mode" IN ('basename', 'ancestor', 'path', 'together')),
	CONSTRAINT "catalog_reviews_result_evidence_title_sources_distance_0" CHECK("catalog_reviews_result_evidence_title_sources"."distance" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_evidence_title_sources_order` ON `catalog_reviews_result_evidence_title_sources` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_evidence_titles` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_evidence_titles_ordinal" CHECK("catalog_reviews_result_evidence_titles"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_evidence_titles_order` ON `catalog_reviews_result_evidence_titles` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_evidence_years` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_evidence_years_ordinal" CHECK("catalog_reviews_result_evidence_years"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_evidence_years_order` ON `catalog_reviews_result_evidence_years` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_proposals` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`candidate_work_reference_provider` text NOT NULL,
	`candidate_work_reference_media_type` text NOT NULL,
	`candidate_work_reference_id` text NOT NULL,
	`candidate_work_snapshot_id` text NOT NULL,
	`candidate_work_title_variants_present` integer NOT NULL,
	`candidate_work_year` integer,
	`candidate_work_format` text,
	`candidate_work_episode_count` integer,
	`candidate_work_season` text,
	`candidate_work_part` text,
	`candidate_work_ordinal_source` text,
	`candidate_score` real NOT NULL,
	`candidate_identity_conflicts_present` integer NOT NULL,
	`candidate_identity_unresolved_present` integer NOT NULL,
	`candidate_assumptions_present` integer NOT NULL,
	`candidate_matcher_version` text NOT NULL,
	`mapping_numbering_present` integer NOT NULL,
	`mapping_numbering_source` text,
	`mapping_numbering_offset` integer,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_proposals_ordinal" CHECK("catalog_reviews_result_proposals"."ordinal_index" >= 0),
	CONSTRAINT "catalog_reviews_result_proposals_candidate_work_reference_media_type_0" CHECK("catalog_reviews_result_proposals"."candidate_work_reference_media_type" IN ('anime')),
	CONSTRAINT "catalog_reviews_result_proposals_candidate_work_title_variants_present_0" CHECK("catalog_reviews_result_proposals"."candidate_work_title_variants_present" IN (0, 1)),
	CONSTRAINT "catalog_reviews_result_proposals_candidate_work_ordinal_source_0" CHECK("catalog_reviews_result_proposals"."candidate_work_ordinal_source" IN ('provider-title')),
	CONSTRAINT "catalog_reviews_result_proposals_candidate_identity_conflicts_present_0" CHECK("catalog_reviews_result_proposals"."candidate_identity_conflicts_present" IN (0, 1)),
	CONSTRAINT "catalog_reviews_result_proposals_candidate_identity_unresolved_present_0" CHECK("catalog_reviews_result_proposals"."candidate_identity_unresolved_present" IN (0, 1)),
	CONSTRAINT "catalog_reviews_result_proposals_candidate_assumptions_present_0" CHECK("catalog_reviews_result_proposals"."candidate_assumptions_present" IN (0, 1)),
	CONSTRAINT "catalog_reviews_result_proposals_mapping_numbering_present_0" CHECK("catalog_reviews_result_proposals"."mapping_numbering_present" IN (0, 1)),
	CONSTRAINT "catalog_reviews_result_proposals_mapping_numbering_source_0" CHECK("catalog_reviews_result_proposals"."mapping_numbering_source" IN ('directory-anchors'))
);

--> statement-breakpoint
CREATE INDEX `catalog_review_candidate_reference` ON `catalog_reviews_result_proposals` (`candidate_work_reference_provider`,`candidate_work_reference_media_type`,`candidate_work_reference_id`,`parent_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_proposals_order` ON `catalog_reviews_result_proposals` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_proposals_candidate_assumptions` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews_result_proposals`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_proposals_candidate_assumptions_ordinal" CHECK("catalog_reviews_result_proposals_candidate_assumptions"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_proposals_candidate_assumptions_order` ON `catalog_reviews_result_proposals_candidate_assumptions` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_proposals_candidate_conflicts` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews_result_proposals`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_proposals_candidate_conflicts_ordinal" CHECK("catalog_reviews_result_proposals_candidate_conflicts"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_proposals_candidate_conflicts_order` ON `catalog_reviews_result_proposals_candidate_conflicts` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_proposals_candidate_identity_conflicts` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews_result_proposals`(`row_id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_proposals_candidate_identity_conflicts_order` ON `catalog_reviews_result_proposals_candidate_identity_conflicts` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_proposals_candidate_identity_unresolved` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews_result_proposals`(`row_id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_proposals_candidate_identity_unresolved_order` ON `catalog_reviews_result_proposals_candidate_identity_unresolved` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_proposals_candidate_reasons` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews_result_proposals`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_proposals_candidate_reasons_ordinal" CHECK("catalog_reviews_result_proposals_candidate_reasons"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_proposals_candidate_reasons_order` ON `catalog_reviews_result_proposals_candidate_reasons` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_proposals_candidate_work_title_variants` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	`kind` text NOT NULL,
	`language` text,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews_result_proposals`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_proposals_candidate_work_title_variants_kind_0" CHECK("catalog_reviews_result_proposals_candidate_work_title_variants"."kind" IN ('primary', 'alias'))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_proposals_candidate_work_title_variants_order` ON `catalog_reviews_result_proposals_candidate_work_title_variants` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_proposals_candidate_work_titles` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews_result_proposals`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_proposals_candidate_work_titles_ordinal" CHECK("catalog_reviews_result_proposals_candidate_work_titles"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_proposals_candidate_work_titles_order` ON `catalog_reviews_result_proposals_candidate_work_titles` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_proposals_mapping_numbering_anchors` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`file_id` text NOT NULL,
	`source_version` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews_result_proposals`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_proposals_mapping_numbering_anchors_ordinal" CHECK("catalog_reviews_result_proposals_mapping_numbering_anchors"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_proposals_mapping_numbering_anchors_order` ON `catalog_reviews_result_proposals_mapping_numbering_anchors` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_proposals_mapping_reasons` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews_result_proposals`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_proposals_mapping_reasons_ordinal" CHECK("catalog_reviews_result_proposals_mapping_reasons"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_proposals_mapping_reasons_order` ON `catalog_reviews_result_proposals_mapping_reasons` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_proposals_mapping_targets` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`kind` text NOT NULL,
	`number` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews_result_proposals`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_proposals_mapping_targets_ordinal" CHECK("catalog_reviews_result_proposals_mapping_targets"."ordinal_index" >= 0),
	CONSTRAINT "catalog_reviews_result_proposals_mapping_targets_kind_0" CHECK("catalog_reviews_result_proposals_mapping_targets"."kind" IN ('regular', 'special', 'movie'))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_proposals_mapping_targets_order` ON `catalog_reviews_result_proposals_mapping_targets` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_proposals_mapping_unresolved` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews_result_proposals`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_proposals_mapping_unresolved_ordinal" CHECK("catalog_reviews_result_proposals_mapping_unresolved"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_proposals_mapping_unresolved_order` ON `catalog_reviews_result_proposals_mapping_unresolved` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_reviews_result_unresolved` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_reviews_result_unresolved_ordinal" CHECK("catalog_reviews_result_unresolved"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_unresolved_order` ON `catalog_reviews_result_unresolved` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `catalog_works` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_title` text NOT NULL,
	`format` text,
	`year` integer,
	`episode_count` integer,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "catalog_works_episode_count_0" CHECK("catalog_works"."episode_count" >= 0),
	CONSTRAINT "catalog_works_revision_0" CHECK("catalog_works"."revision" >= 0)
);

--> statement-breakpoint
CREATE TABLE `catalog_works_search_titles` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `catalog_works`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "catalog_works_search_titles_ordinal" CHECK("catalog_works_search_titles"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_works_search_titles_order` ON `catalog_works_search_titles` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `media_access_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`source_version` text NOT NULL,
	`fingerprint` text NOT NULL,
	`expires_at` integer NOT NULL
);

--> statement-breakpoint
CREATE INDEX `media_access_links_expiry` ON `media_access_links` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `media_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`root_id` text NOT NULL,
	`file_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`source_version` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`root_id`) REFERENCES `resource_roots`(`id`) ON UPDATE no action ON DELETE restrict
);

--> statement-breakpoint
CREATE UNIQUE INDEX `media_sources_identity` ON `media_sources` (`root_id`,`file_id`,`source_version`);
--> statement-breakpoint
CREATE INDEX `media_sources_root` ON `media_sources` (`root_id`,`id`);
--> statement-breakpoint
CREATE TABLE `metadata_artwork` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_key` text NOT NULL,
	`url` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`accessed_at` integer NOT NULL,
	CONSTRAINT "metadata_artwork_size" CHECK("metadata_artwork"."size_bytes" >= 0)
);

--> statement-breakpoint
CREATE INDEX `metadata_artwork_lru` ON `metadata_artwork` (`accessed_at`);
--> statement-breakpoint
CREATE TABLE `metadata_pins` (
	`snapshot_id` text NOT NULL,
	`owner_id` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `owner_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `metadata_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
CREATE TABLE `metadata_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accessed_at` integer NOT NULL,
	`failure_present` integer NOT NULL,
	`failure_code` text,
	`failure_message` text,
	`failure_retry_at` integer,
	`page` integer,
	`per_page` integer,
	`has_next_page` integer,
	`detail_present` integer NOT NULL,
	`detail_reference_provider` text,
	`detail_reference_media_type` text,
	`detail_reference_id` text,
	`detail_year` integer,
	`detail_format` text,
	`detail_status` text,
	`detail_episode_count` integer,
	`detail_airing_season` text,
	`detail_cover_url` text,
	`detail_description` text,
	`detail_banner_url` text,
	`detail_start_date_present` integer NOT NULL,
	`detail_start_date_year` integer,
	`detail_start_date_month` integer,
	`detail_start_date_day` integer,
	`detail_end_date_present` integer NOT NULL,
	`detail_end_date_year` integer,
	`detail_end_date_month` integer,
	`detail_end_date_day` integer,
	`detail_duration_minutes` integer,
	`detail_country` text,
	`detail_source` text,
	`detail_average_score` integer,
	`detail_site_url` text,
	`detail_provider_updated_at` integer,
	`detail_episode_catalog` text,
	CONSTRAINT "metadata_snapshot_projection" CHECK(("metadata_snapshots"."kind" = 'detail' AND "metadata_snapshots"."detail_present" = 1) OR ("metadata_snapshots"."kind" <> 'detail' AND "metadata_snapshots"."detail_present" = 0 AND "metadata_snapshots"."page" IS NOT NULL AND "metadata_snapshots"."per_page" IS NOT NULL AND "metadata_snapshots"."has_next_page" IS NOT NULL)),
	CONSTRAINT "metadata_snapshot_failure" CHECK("metadata_snapshots"."failure_present" = 0 OR ("metadata_snapshots"."failure_code" IS NOT NULL AND "metadata_snapshots"."failure_message" IS NOT NULL)),
	CONSTRAINT "metadata_snapshots_kind_0" CHECK("metadata_snapshots"."kind" IN ('search', 'detail', 'relations', 'airing')),
	CONSTRAINT "metadata_snapshots_failure_present_0" CHECK("metadata_snapshots"."failure_present" IN (0, 1)),
	CONSTRAINT "metadata_snapshots_has_next_page_0" CHECK("metadata_snapshots"."has_next_page" IN (0, 1)),
	CONSTRAINT "metadata_snapshots_detail_present_0" CHECK("metadata_snapshots"."detail_present" IN (0, 1)),
	CONSTRAINT "metadata_snapshots_detail_reference_media_type_0" CHECK("metadata_snapshots"."detail_reference_media_type" IN ('anime')),
	CONSTRAINT "metadata_snapshots_detail_episode_count_0" CHECK("metadata_snapshots"."detail_episode_count" >= 0),
	CONSTRAINT "metadata_snapshots_detail_start_date_present_0" CHECK("metadata_snapshots"."detail_start_date_present" IN (0, 1)),
	CONSTRAINT "metadata_snapshots_detail_end_date_present_0" CHECK("metadata_snapshots"."detail_end_date_present" IN (0, 1)),
	CONSTRAINT "metadata_snapshots_detail_episode_catalog_0" CHECK("metadata_snapshots"."detail_episode_catalog" IN ('unavailable'))
);

--> statement-breakpoint
CREATE INDEX `metadata_cache_key` ON `metadata_snapshots` (`key`,`fetched_at`);
--> statement-breakpoint
CREATE INDEX `metadata_lru` ON `metadata_snapshots` (`kind`,`accessed_at`);
--> statement-breakpoint
CREATE TABLE `metadata_snapshots_airing` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`id` text NOT NULL,
	`episode` integer NOT NULL,
	`airing_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `metadata_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "metadata_snapshots_airing_ordinal" CHECK("metadata_snapshots_airing"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_snapshots_airing_order` ON `metadata_snapshots_airing` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `metadata_snapshots_detail_genres` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `metadata_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "metadata_snapshots_detail_genres_ordinal" CHECK("metadata_snapshots_detail_genres"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_snapshots_detail_genres_order` ON `metadata_snapshots_detail_genres` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `metadata_snapshots_detail_streaming_episodes` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`title` text,
	`url` text,
	`site` text,
	`thumbnail` text,
	FOREIGN KEY (`parent_id`) REFERENCES `metadata_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "metadata_snapshots_detail_streaming_episodes_ordinal" CHECK("metadata_snapshots_detail_streaming_episodes"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_snapshots_detail_streaming_episodes_order` ON `metadata_snapshots_detail_streaming_episodes` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `metadata_snapshots_detail_studios` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `metadata_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "metadata_snapshots_detail_studios_ordinal" CHECK("metadata_snapshots_detail_studios"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_snapshots_detail_studios_order` ON `metadata_snapshots_detail_studios` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `metadata_snapshots_detail_tags` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`name` text NOT NULL,
	`rank` integer,
	`spoiler` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `metadata_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "metadata_snapshots_detail_tags_ordinal" CHECK("metadata_snapshots_detail_tags"."ordinal_index" >= 0),
	CONSTRAINT "metadata_snapshots_detail_tags_spoiler_0" CHECK("metadata_snapshots_detail_tags"."spoiler" IN (0, 1))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_snapshots_detail_tags_order` ON `metadata_snapshots_detail_tags` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `metadata_snapshots_detail_titles` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	`language` text,
	`kind` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `metadata_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "metadata_snapshots_detail_titles_ordinal" CHECK("metadata_snapshots_detail_titles"."ordinal_index" >= 0),
	CONSTRAINT "metadata_snapshots_detail_titles_kind_0" CHECK("metadata_snapshots_detail_titles"."kind" IN ('romaji', 'english', 'native', 'alias'))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_snapshots_detail_titles_order` ON `metadata_snapshots_detail_titles` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `metadata_snapshots_detail_unavailable_fields` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `metadata_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "metadata_snapshots_detail_unavailable_fields_ordinal" CHECK("metadata_snapshots_detail_unavailable_fields"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_snapshots_detail_unavailable_fields_order` ON `metadata_snapshots_detail_unavailable_fields` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `metadata_snapshots_items` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`reference_provider` text NOT NULL,
	`reference_media_type` text NOT NULL,
	`reference_id` text NOT NULL,
	`year` integer,
	`format` text,
	`status` text,
	`episode_count` integer,
	`airing_season` text,
	`cover_url` text,
	FOREIGN KEY (`parent_id`) REFERENCES `metadata_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "metadata_snapshots_items_ordinal" CHECK("metadata_snapshots_items"."ordinal_index" >= 0),
	CONSTRAINT "metadata_snapshots_items_reference_media_type_0" CHECK("metadata_snapshots_items"."reference_media_type" IN ('anime')),
	CONSTRAINT "metadata_snapshots_items_episode_count_0" CHECK("metadata_snapshots_items"."episode_count" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_snapshots_items_order` ON `metadata_snapshots_items` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `metadata_snapshots_items_titles` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	`language` text,
	`kind` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `metadata_snapshots_items`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "metadata_snapshots_items_titles_ordinal" CHECK("metadata_snapshots_items_titles"."ordinal_index" >= 0),
	CONSTRAINT "metadata_snapshots_items_titles_kind_0" CHECK("metadata_snapshots_items_titles"."kind" IN ('romaji', 'english', 'native', 'alias'))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_snapshots_items_titles_order` ON `metadata_snapshots_items_titles` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `metadata_snapshots_items_unavailable_fields` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `metadata_snapshots_items`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "metadata_snapshots_items_unavailable_fields_ordinal" CHECK("metadata_snapshots_items_unavailable_fields"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_snapshots_items_unavailable_fields_order` ON `metadata_snapshots_items_unavailable_fields` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `metadata_snapshots_relations` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`type` text NOT NULL,
	`work_reference_provider` text NOT NULL,
	`work_reference_media_type` text NOT NULL,
	`work_reference_id` text NOT NULL,
	`work_year` integer,
	`work_format` text,
	`work_status` text,
	`work_episode_count` integer,
	`work_airing_season` text,
	`work_cover_url` text,
	FOREIGN KEY (`parent_id`) REFERENCES `metadata_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "metadata_snapshots_relations_ordinal" CHECK("metadata_snapshots_relations"."ordinal_index" >= 0),
	CONSTRAINT "metadata_snapshots_relations_work_reference_media_type_0" CHECK("metadata_snapshots_relations"."work_reference_media_type" IN ('anime')),
	CONSTRAINT "metadata_snapshots_relations_work_episode_count_0" CHECK("metadata_snapshots_relations"."work_episode_count" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_snapshots_relations_order` ON `metadata_snapshots_relations` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `metadata_snapshots_relations_work_titles` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	`language` text,
	`kind` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `metadata_snapshots_relations`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "metadata_snapshots_relations_work_titles_ordinal" CHECK("metadata_snapshots_relations_work_titles"."ordinal_index" >= 0),
	CONSTRAINT "metadata_snapshots_relations_work_titles_kind_0" CHECK("metadata_snapshots_relations_work_titles"."kind" IN ('romaji', 'english', 'native', 'alias'))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_snapshots_relations_work_titles_order` ON `metadata_snapshots_relations_work_titles` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `metadata_snapshots_relations_work_unavailable_fields` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `metadata_snapshots_relations`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "metadata_snapshots_relations_work_unavailable_fields_ordinal" CHECK("metadata_snapshots_relations_work_unavailable_fields"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_snapshots_relations_work_unavailable_fields_order` ON `metadata_snapshots_relations_work_unavailable_fields` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `playback_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`attempted_at` integer NOT NULL,
	`context_version` integer NOT NULL,
	`context_account_id` text NOT NULL,
	`context_generation` text NOT NULL,
	`context_manual_version` integer NOT NULL,
	`context_file_id` text NOT NULL,
	`context_source_version` text NOT NULL,
	`context_review_id` text NOT NULL,
	`context_mapping_revision` integer NOT NULL,
	`context_episode_id` text NOT NULL,
	`context_media_id` text NOT NULL,
	`context_episode` integer NOT NULL,
	`outcome_state` text NOT NULL,
	`outcome_reason` text NOT NULL,
	`outcome_operation_id` text,
	`outcome_revision` integer,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "playback_context_version" CHECK("playback_completions"."context_version" = 2),
	CONSTRAINT "playback_context_values" CHECK("playback_completions"."context_manual_version" >= 0 AND "playback_completions"."context_mapping_revision" >= 0 AND "playback_completions"."context_episode" >= 1),
	CONSTRAINT "playback_completions_attempted_at_0" CHECK("playback_completions"."attempted_at" >= 0),
	CONSTRAINT "playback_completions_outcome_state_0" CHECK("playback_completions"."outcome_state" IN ('pending', 'accepted', 'ignored', 'unavailable')),
	CONSTRAINT "playback_completions_outcome_revision_0" CHECK("playback_completions"."outcome_revision" >= 0)
);

--> statement-breakpoint
CREATE INDEX `playback_completion_delivery` ON `playback_completions` (`outcome_state`,`attempted_at`,`id`);
--> statement-breakpoint
CREATE INDEX `playback_completion_source` ON `playback_completions` (`source_id`);
--> statement-breakpoint
CREATE TABLE `playback_progress` (
	`source_id` text PRIMARY KEY NOT NULL,
	`position_ms` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`last_viewed_at_ms` integer,
	`generation` integer DEFAULT 1 NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "progress_position" CHECK("playback_progress"."position_ms" >= 0),
	CONSTRAINT "progress_duration" CHECK("playback_progress"."duration_ms" IS NULL OR ("playback_progress"."duration_ms" > 0 AND "playback_progress"."position_ms" <= "playback_progress"."duration_ms")),
	CONSTRAINT "progress_generation" CHECK("playback_progress"."generation" >= 1),
	CONSTRAINT "progress_sequence" CHECK("playback_progress"."last_sequence" >= 0)
);

--> statement-breakpoint
CREATE INDEX `progress_recent` ON `playback_progress` ("last_viewed_at_ms" desc,`source_id`);
--> statement-breakpoint
CREATE TABLE `preparation_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`execution_plan_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`profile_fingerprint` text NOT NULL,
	`filename` text NOT NULL,
	`snapshot_version` integer NOT NULL,
	`snapshot_mode` text NOT NULL,
	`snapshot_reasons_video` text NOT NULL,
	`snapshot_reasons_audio` text NOT NULL,
	`snapshot_video_stream_index` integer NOT NULL,
	`snapshot_plan_container` text NOT NULL,
	`snapshot_plan_delivery` text,
	`snapshot_plan_output_format` text NOT NULL,
	`snapshot_plan_video_action` text NOT NULL,
	`snapshot_plan_video_encoder` text,
	`snapshot_plan_video_codec` text,
	`snapshot_plan_video_pixel_format` text,
	`snapshot_plan_audio_action` text NOT NULL,
	`snapshot_plan_audio_encoder` text,
	`snapshot_plan_audio_codec` text,
	`snapshot_plan_audio_pixel_format` text,
	`snapshot_plan_video_parameters_present` integer NOT NULL,
	`snapshot_plan_video_parameters_pixel_format` text,
	`snapshot_plan_video_parameters_max_height` integer,
	`snapshot_plan_video_parameters_encoder` text,
	`snapshot_plan_video_parameters_codec` text,
	`snapshot_plan_video_parameters_crf` real,
	`snapshot_plan_video_parameters_preset` text,
	`snapshot_plan_video_parameters_cpu_used` integer,
	`snapshot_plan_video_parameters_bitrate_kbps` integer,
	`snapshot_plan_audio_parameters_present` integer NOT NULL,
	`snapshot_plan_audio_parameters_channels` text,
	`snapshot_plan_audio_parameters_encoder` text,
	`snapshot_plan_audio_parameters_codec` text,
	`snapshot_plan_audio_parameters_bitrate_kbps` integer,
	`snapshot_plan_audio_parameters_compression_level` integer,
	`snapshot_plan_video_filters_present` integer NOT NULL,
	`snapshot_plan_h264_level` text,
	`status` text NOT NULL,
	`progress_present` integer NOT NULL,
	`progress_media_time_ms` real,
	`progress_frames` integer,
	`progress_output_bytes` integer,
	`progress_speed` real,
	`progress_percent` real,
	`progress_ended` integer,
	`failure_reason` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "preparation_snapshot_version" CHECK("preparation_tasks"."snapshot_version" = 1),
	CONSTRAINT "preparation_progress_shape" CHECK("preparation_tasks"."progress_present" = 0 OR ("preparation_tasks"."progress_ended" IS NOT NULL AND ("preparation_tasks"."progress_percent" IS NULL OR "preparation_tasks"."progress_percent" BETWEEN 0 AND 100))),
	CONSTRAINT "preparation_failure_reason" CHECK("preparation_tasks"."failure_reason" IN ('interrupted', 'cancelled', 'cache-deleted', 'cache-missing', 'cache-full', 'storage-full', 'source-changed', 'profile-changed', 'tool-unavailable', 'capability-missing', 'capability-unknown', 'processing-failed')),
	CONSTRAINT "preparation_state_shape" CHECK(("preparation_tasks"."status" IN ('queued', 'processing', 'cancelling', 'ready') AND "preparation_tasks"."failure_reason" IS NULL AND ("preparation_tasks"."status" <> 'queued' OR "preparation_tasks"."progress_present" = 0)) OR ("preparation_tasks"."status" = 'failed' AND "preparation_tasks"."failure_reason" IS NOT NULL) OR ("preparation_tasks"."status" = 'cancelled' AND "preparation_tasks"."failure_reason" IS NOT NULL AND "preparation_tasks"."failure_reason" IN ('cancelled', 'cache-deleted'))),
	CONSTRAINT "preparation_tasks_snapshot_mode_0" CHECK("preparation_tasks"."snapshot_mode" IN ('remux', 'transcode-audio', 'transcode-video', 'transcode')),
	CONSTRAINT "preparation_tasks_snapshot_video_stream_index_0" CHECK("preparation_tasks"."snapshot_video_stream_index" >= 0),
	CONSTRAINT "preparation_tasks_snapshot_plan_delivery_0" CHECK("preparation_tasks"."snapshot_plan_delivery" IN ('file', 'media-source')),
	CONSTRAINT "preparation_tasks_snapshot_plan_video_action_0" CHECK("preparation_tasks"."snapshot_plan_video_action" IN ('copy', 'encode')),
	CONSTRAINT "preparation_tasks_snapshot_plan_audio_action_0" CHECK("preparation_tasks"."snapshot_plan_audio_action" IN ('copy', 'encode')),
	CONSTRAINT "preparation_tasks_snapshot_plan_video_parameters_present_0" CHECK("preparation_tasks"."snapshot_plan_video_parameters_present" IN (0, 1)),
	CONSTRAINT "preparation_tasks_snapshot_plan_audio_parameters_present_0" CHECK("preparation_tasks"."snapshot_plan_audio_parameters_present" IN (0, 1)),
	CONSTRAINT "preparation_tasks_snapshot_plan_audio_parameters_channels_0" CHECK("preparation_tasks"."snapshot_plan_audio_parameters_channels" IN ('preserve', 'stereo')),
	CONSTRAINT "preparation_tasks_snapshot_plan_video_filters_present_0" CHECK("preparation_tasks"."snapshot_plan_video_filters_present" IN (0, 1)),
	CONSTRAINT "preparation_tasks_snapshot_plan_h264_level_0" CHECK("preparation_tasks"."snapshot_plan_h264_level" IN ('5.1')),
	CONSTRAINT "preparation_tasks_status_0" CHECK("preparation_tasks"."status" IN ('queued', 'processing', 'cancelling', 'ready', 'failed', 'cancelled')),
	CONSTRAINT "preparation_tasks_progress_present_0" CHECK("preparation_tasks"."progress_present" IN (0, 1)),
	CONSTRAINT "preparation_tasks_progress_ended_0" CHECK("preparation_tasks"."progress_ended" IN (0, 1))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `preparation_tasks_execution_plan_id_unique` ON `preparation_tasks` (`execution_plan_id`);
--> statement-breakpoint
CREATE INDEX `preparation_queue` ON `preparation_tasks` (`status`,`updated_at_ms`,`id`);
--> statement-breakpoint
CREATE INDEX `preparation_source` ON `preparation_tasks` (`source_id`);
--> statement-breakpoint
CREATE TABLE `preparation_tasks_snapshot_audio_stream_indices` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `preparation_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "preparation_tasks_snapshot_audio_stream_indices_ordinal" CHECK("preparation_tasks_snapshot_audio_stream_indices"."ordinal_index" >= 0),
	CONSTRAINT "preparation_tasks_snapshot_audio_stream_indices_value_0" CHECK("preparation_tasks_snapshot_audio_stream_indices"."value" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `preparation_tasks_snapshot_audio_stream_indices_order` ON `preparation_tasks_snapshot_audio_stream_indices` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `preparation_tasks_snapshot_plan_filters` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `preparation_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "preparation_tasks_snapshot_plan_filters_ordinal" CHECK("preparation_tasks_snapshot_plan_filters"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `preparation_tasks_snapshot_plan_filters_order` ON `preparation_tasks_snapshot_plan_filters` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `preparation_tasks_snapshot_plan_video_filters` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `preparation_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "preparation_tasks_snapshot_plan_video_filters_ordinal" CHECK("preparation_tasks_snapshot_plan_video_filters"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `preparation_tasks_snapshot_plan_video_filters_order` ON `preparation_tasks_snapshot_plan_video_filters` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `prepared_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`mime_type` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `preparation_tasks`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "prepared_size" CHECK("prepared_artifacts"."size_bytes" > 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `prepared_artifacts_task_id_unique` ON `prepared_artifacts` (`task_id`);
--> statement-breakpoint
CREATE TABLE `resource_roots` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at_ms` integer NOT NULL
);

--> statement-breakpoint
CREATE TABLE `subtitle_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`track_id` text NOT NULL,
	`stream_index` integer NOT NULL,
	`processing_version` text NOT NULL,
	`format` text NOT NULL,
	`status` text NOT NULL,
	`size_bytes` integer,
	`error_code` text,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "subtitle_asset_error" CHECK("subtitle_assets"."error_code" IN ('SUBTITLE_EXTRACTION_FAILED', 'SUBTITLE_TOOL_UNAVAILABLE', 'SUBTITLE_TOO_LARGE', 'SUBTITLE_CACHE_FULL', 'PLAYBACK_CONFLICT', 'SUBTITLE_INTERRUPTED')),
	CONSTRAINT "subtitle_asset_result" CHECK(("subtitle_assets"."status" = 'failed' AND "subtitle_assets"."error_code" IS NOT NULL) OR ("subtitle_assets"."status" IN ('pending', 'ready') AND "subtitle_assets"."error_code" IS NULL)),
	CONSTRAINT "subtitle_asset_format" CHECK("subtitle_assets"."format" IN ('webvtt', 'srt', 'ass', 'ssa')),
	CONSTRAINT "subtitle_stream_index" CHECK("subtitle_assets"."stream_index" >= 0),
	CONSTRAINT "subtitle_asset_size" CHECK("subtitle_assets"."size_bytes" IS NULL OR "subtitle_assets"."size_bytes" >= 0),
	CONSTRAINT "subtitle_asset_state" CHECK("subtitle_assets"."status" IN ('pending', 'ready', 'failed'))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `subtitle_asset_identity` ON `subtitle_assets` (`source_id`,`track_id`,`format`,`processing_version`);
--> statement-breakpoint
CREATE TABLE `subtitle_font_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`set_id` text NOT NULL,
	`stream_index` integer NOT NULL,
	`format` text NOT NULL,
	`family` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`digest` text NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `subtitle_font_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "subtitle_font_stream" CHECK("subtitle_font_assets"."stream_index" >= 0),
	CONSTRAINT "subtitle_font_size" CHECK("subtitle_font_assets"."size_bytes" > 0),
	CONSTRAINT "subtitle_font_format" CHECK("subtitle_font_assets"."format" IN ('ttf', 'otf'))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `subtitle_font_attachment` ON `subtitle_font_assets` (`set_id`,`stream_index`);
--> statement-breakpoint
CREATE TABLE `subtitle_font_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "subtitle_font_sets_status_0" CHECK("subtitle_font_sets"."status" IN ('pending', 'ready', 'degraded'))
);

--> statement-breakpoint
CREATE INDEX `subtitle_font_source` ON `subtitle_font_sets` (`source_id`);
--> statement-breakpoint
CREATE TABLE `subtitle_font_sets_warnings` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `subtitle_font_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "subtitle_font_sets_warnings_ordinal" CHECK("subtitle_font_sets_warnings"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `subtitle_font_sets_warnings_order` ON `subtitle_font_sets_warnings` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `tracking_commands` (
	`account_id` text NOT NULL,
	`command_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`revision` integer NOT NULL,
	PRIMARY KEY(`account_id`, `command_id`),
	CONSTRAINT "tracking_command_revision" CHECK("tracking_commands"."revision" >= 0)
);

--> statement-breakpoint
CREATE TABLE `tracking_connection` (
	`id` integer PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`account_id` text,
	`account_name` text,
	`credential_id` text,
	`state` text NOT NULL,
	`checked_at` integer,
	CONSTRAINT "tracking_connection_singleton" CHECK("tracking_connection"."id" = 1),
	CONSTRAINT "tracking_connection_state" CHECK("tracking_connection"."state" IN ('disconnected', 'connected', 'authorization-required')),
	CONSTRAINT "tracking_connection_account" CHECK(("tracking_connection"."account_id" IS NULL) = ("tracking_connection"."account_name" IS NULL)),
	CONSTRAINT "tracking_connection_credentials" CHECK("tracking_connection"."state" <> 'connected' OR ("tracking_connection"."account_id" IS NOT NULL AND "tracking_connection"."credential_id" IS NOT NULL))
);

--> statement-breakpoint
CREATE TABLE `tracking_intent_versions` (
	`account_id` text NOT NULL,
	`media_id` text NOT NULL,
	`manual_version` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`account_id`, `media_id`),
	CONSTRAINT "tracking_manual_version" CHECK("tracking_intent_versions"."manual_version" >= 0)
);

--> statement-breakpoint
CREATE TABLE `tracking_list_cache` (
	`invalidated` integer,
	`account_id` text PRIMARY KEY NOT NULL,
	`fetched_at` integer NOT NULL,
	CONSTRAINT "tracking_list_cache_invalidated_0" CHECK("tracking_list_cache"."invalidated" IN (0, 1))
);

--> statement-breakpoint
CREATE TABLE `tracking_list_cache_entries` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`id` text NOT NULL,
	`media_id` text NOT NULL,
	`progress` integer NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer,
	`format` text,
	`year` integer,
	`episode_count` integer,
	`cover_url` text,
	FOREIGN KEY (`parent_id`) REFERENCES `tracking_list_cache`(`account_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tracking_list_cache_entries_ordinal" CHECK("tracking_list_cache_entries"."ordinal_index" >= 0),
	CONSTRAINT "tracking_list_cache_entries_progress_0" CHECK("tracking_list_cache_entries"."progress" >= 0),
	CONSTRAINT "tracking_list_cache_entries_status_0" CHECK("tracking_list_cache_entries"."status" IN ('watching', 'planned', 'completed', 'paused', 'dropped', 'rewatching'))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_list_entry_media` ON `tracking_list_cache_entries` (`parent_id`,`media_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_list_cache_entries_order` ON `tracking_list_cache_entries` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `tracking_list_cache_entries_titles` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `tracking_list_cache_entries`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tracking_list_cache_entries_titles_ordinal" CHECK("tracking_list_cache_entries_titles"."ordinal_index" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_list_cache_entries_titles_order` ON `tracking_list_cache_entries_titles` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
CREATE TABLE `tracking_operations` (
	`origin` text NOT NULL,
	`command_id` text NOT NULL,
	`intent_at` integer NOT NULL,
	`target_present` integer NOT NULL,
	`target_file_id` text,
	`target_source_version` text,
	`target_review_id` text,
	`target_mapping_revision` integer,
	`target_episode_id` text,
	`target_media_id` text,
	`target_episode` integer,
	`decision_reason` text,
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`media_id` text NOT NULL,
	`revision` integer NOT NULL,
	`baseline_present` integer NOT NULL,
	`baseline_id` text,
	`baseline_progress` integer,
	`baseline_status` text,
	`baseline_updated_at` integer,
	`desired_progress` integer,
	`desired_status` text,
	`state` text NOT NULL,
	`remote_present` integer NOT NULL,
	`remote_id` text,
	`remote_progress` integer,
	`remote_status` text,
	`remote_updated_at` integer,
	`attempt_present` integer NOT NULL,
	`attempt_revision` integer,
	`attempt_baseline_present` integer NOT NULL,
	`attempt_baseline_id` text,
	`attempt_baseline_progress` integer,
	`attempt_baseline_status` text,
	`attempt_baseline_updated_at` integer,
	`attempt_desired_progress` integer,
	`attempt_desired_status` text,
	`attempts` integer NOT NULL,
	`retry_at` integer,
	`error` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "tracking_operations_origin_0" CHECK("tracking_operations"."origin" IN ('manual-detail', 'manual-player', 'automatic')),
	CONSTRAINT "tracking_operations_target_present_0" CHECK("tracking_operations"."target_present" IN (0, 1)),
	CONSTRAINT "tracking_operations_target_mapping_revision_0" CHECK("tracking_operations"."target_mapping_revision" >= 0),
	CONSTRAINT "tracking_operations_target_episode_0" CHECK("tracking_operations"."target_episode" >= 1),
	CONSTRAINT "tracking_operations_decision_reason_0" CHECK("tracking_operations"."decision_reason" IN ('skipped-episodes', 'initial-status-required')),
	CONSTRAINT "tracking_operations_revision_0" CHECK("tracking_operations"."revision" >= 0),
	CONSTRAINT "tracking_operations_baseline_present_0" CHECK("tracking_operations"."baseline_present" IN (0, 1)),
	CONSTRAINT "tracking_operations_baseline_progress_0" CHECK("tracking_operations"."baseline_progress" >= 0),
	CONSTRAINT "tracking_operations_baseline_status_0" CHECK("tracking_operations"."baseline_status" IN ('watching', 'planned', 'completed', 'paused', 'dropped', 'rewatching')),
	CONSTRAINT "tracking_operations_desired_progress_0" CHECK("tracking_operations"."desired_progress" >= 0),
	CONSTRAINT "tracking_operations_desired_status_0" CHECK("tracking_operations"."desired_status" IN ('watching', 'planned', 'completed', 'paused', 'dropped', 'rewatching')),
	CONSTRAINT "tracking_operations_state_0" CHECK("tracking_operations"."state" IN ('decision-required', 'pending', 'submitting', 'failed', 'conflict', 'authorization-required', 'succeeded', 'cancelled')),
	CONSTRAINT "tracking_operations_remote_present_0" CHECK("tracking_operations"."remote_present" IN (0, 1)),
	CONSTRAINT "tracking_operations_remote_progress_0" CHECK("tracking_operations"."remote_progress" >= 0),
	CONSTRAINT "tracking_operations_remote_status_0" CHECK("tracking_operations"."remote_status" IN ('watching', 'planned', 'completed', 'paused', 'dropped', 'rewatching')),
	CONSTRAINT "tracking_operations_attempt_present_0" CHECK("tracking_operations"."attempt_present" IN (0, 1)),
	CONSTRAINT "tracking_operations_attempt_revision_0" CHECK("tracking_operations"."attempt_revision" >= 0),
	CONSTRAINT "tracking_operations_attempt_baseline_present_0" CHECK("tracking_operations"."attempt_baseline_present" IN (0, 1)),
	CONSTRAINT "tracking_operations_attempt_baseline_progress_0" CHECK("tracking_operations"."attempt_baseline_progress" >= 0),
	CONSTRAINT "tracking_operations_attempt_baseline_status_0" CHECK("tracking_operations"."attempt_baseline_status" IN ('watching', 'planned', 'completed', 'paused', 'dropped', 'rewatching')),
	CONSTRAINT "tracking_operations_attempt_desired_progress_0" CHECK("tracking_operations"."attempt_desired_progress" >= 0),
	CONSTRAINT "tracking_operations_attempt_desired_status_0" CHECK("tracking_operations"."attempt_desired_status" IN ('watching', 'planned', 'completed', 'paused', 'dropped', 'rewatching')),
	CONSTRAINT "tracking_operations_attempts_0" CHECK("tracking_operations"."attempts" >= 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_operations_account_media` ON `tracking_operations` (`account_id`,`media_id`);
--> statement-breakpoint
CREATE INDEX `tracking_operations_due` ON `tracking_operations` (`account_id`,`state`,`retry_at`);
--> statement-breakpoint
PRAGMA user_version = 1;
