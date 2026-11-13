-- Register legacy Catalog associations and proposal evidence before replacing external identities.
WITH sources AS (
 SELECT provider, provider_id FROM catalog_provider_links
 UNION SELECT candidate_work_reference_provider, candidate_work_reference_id FROM catalog_reviews_result_proposals
 UNION SELECT provider, provider_id FROM metadata_works
), missing AS MATERIALIZED (
 SELECT sources.*, lower(hex(randomblob(16))) AS token FROM sources
 WHERE NOT EXISTS (SELECT 1 FROM metadata_references r WHERE r.provider=sources.provider AND r.provider_id=sources.provider_id)
), ids AS MATERIALIZED (
 SELECT provider, provider_id, substr(token,1,8)||'-'||substr(token,9,4)||'-4'||substr(token,14,3)||'-8'||substr(token,18,3)||'-'||substr(token,21,12) AS id FROM missing
)
INSERT INTO metadata_references(id, provider, provider_id, work_id) SELECT id, provider, provider_id, id FROM ids;
--> statement-breakpoint
-- Keep the existing descriptive index available to Catalog while its first project snapshot is refreshed.
INSERT INTO metadata_works(key, provider, provider_id, provider_title, titles, format, year, episode_count, status, next_airing_episode, next_airing_at, cover_url, fetched_at, detail, detail_snapshot_id)
SELECT 'metadata:anime:'||r.work_id, 'metadata', r.work_id, w.provider_title, w.titles, w.format, w.year, w.episode_count, w.status, w.next_airing_episode, w.next_airing_at, w.cover_url, w.fetched_at, w.detail, w.detail_snapshot_id
FROM metadata_works w JOIN metadata_references r ON r.provider=w.provider AND r.provider_id=w.provider_id;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_catalog_provider_links` (
	`work_id` text PRIMARY KEY NOT NULL,
	`metadata_work_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `catalog_works`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`snapshot_id`) REFERENCES `metadata_snapshots`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_catalog_provider_links`("work_id", "metadata_work_id", "snapshot_id") SELECT l.work_id, r.work_id, l.snapshot_id FROM catalog_provider_links l JOIN metadata_references r ON r.provider=l.provider AND r.provider_id=l.provider_id;--> statement-breakpoint
DROP TABLE `catalog_provider_links`;--> statement-breakpoint
ALTER TABLE `__new_catalog_provider_links` RENAME TO `catalog_provider_links`;--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_metadata_identity` ON `catalog_provider_links` (`metadata_work_id`);--> statement-breakpoint
CREATE TABLE `__new_catalog_reviews_result_proposals` (
	`row_id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`ordinal_index` integer NOT NULL,
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
	CONSTRAINT "catalog_reviews_result_proposals_ordinal" CHECK("__new_catalog_reviews_result_proposals"."ordinal_index" >= 0),
	CONSTRAINT "catalog_reviews_result_proposals_candidate_work_title_variants_present_0" CHECK("__new_catalog_reviews_result_proposals"."candidate_work_title_variants_present" IN (0, 1)),
	CONSTRAINT "catalog_reviews_result_proposals_candidate_work_ordinal_source_0" CHECK("__new_catalog_reviews_result_proposals"."candidate_work_ordinal_source" IN ('provider-title')),
	CONSTRAINT "catalog_reviews_result_proposals_candidate_identity_conflicts_present_0" CHECK("__new_catalog_reviews_result_proposals"."candidate_identity_conflicts_present" IN (0, 1)),
	CONSTRAINT "catalog_reviews_result_proposals_candidate_identity_unresolved_present_0" CHECK("__new_catalog_reviews_result_proposals"."candidate_identity_unresolved_present" IN (0, 1)),
	CONSTRAINT "catalog_reviews_result_proposals_candidate_assumptions_present_0" CHECK("__new_catalog_reviews_result_proposals"."candidate_assumptions_present" IN (0, 1)),
	CONSTRAINT "catalog_reviews_result_proposals_mapping_numbering_present_0" CHECK("__new_catalog_reviews_result_proposals"."mapping_numbering_present" IN (0, 1)),
	CONSTRAINT "catalog_reviews_result_proposals_mapping_numbering_source_0" CHECK("__new_catalog_reviews_result_proposals"."mapping_numbering_source" IN ('directory-anchors'))
);
--> statement-breakpoint
INSERT INTO `__new_catalog_reviews_result_proposals`("row_id", "parent_id", "ordinal_index", "candidate_work_reference_id", "candidate_work_snapshot_id", "candidate_work_title_variants_present", "candidate_work_year", "candidate_work_format", "candidate_work_episode_count", "candidate_work_season", "candidate_work_part", "candidate_work_ordinal_source", "candidate_score", "candidate_identity_conflicts_present", "candidate_identity_unresolved_present", "candidate_assumptions_present", "candidate_matcher_version", "mapping_numbering_present", "mapping_numbering_source", "mapping_numbering_offset") SELECT "row_id", "parent_id", "ordinal_index", (SELECT work_id FROM metadata_references r WHERE r.provider=catalog_reviews_result_proposals.candidate_work_reference_provider AND r.provider_id=catalog_reviews_result_proposals.candidate_work_reference_id), "candidate_work_snapshot_id", "candidate_work_title_variants_present", "candidate_work_year", "candidate_work_format", "candidate_work_episode_count", "candidate_work_season", "candidate_work_part", "candidate_work_ordinal_source", "candidate_score", "candidate_identity_conflicts_present", "candidate_identity_unresolved_present", "candidate_assumptions_present", "candidate_matcher_version", "mapping_numbering_present", "mapping_numbering_source", "mapping_numbering_offset" FROM `catalog_reviews_result_proposals`;--> statement-breakpoint
DROP TABLE `catalog_reviews_result_proposals`;--> statement-breakpoint
ALTER TABLE `__new_catalog_reviews_result_proposals` RENAME TO `catalog_reviews_result_proposals`;--> statement-breakpoint
CREATE INDEX `catalog_review_candidate_reference` ON `catalog_reviews_result_proposals` (`candidate_work_reference_id`,`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_reviews_result_proposals_order` ON `catalog_reviews_result_proposals` (`parent_id`,`ordinal_index`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
