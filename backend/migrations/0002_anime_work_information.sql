CREATE TABLE `metadata_works` (
	`key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text NOT NULL,
	`provider_title` text NOT NULL,
	`titles` text NOT NULL,
	`format` text,
	`year` integer,
	`episode_count` integer,
	`cover_url` text,
	`fetched_at` integer NOT NULL,
	`detail` integer NOT NULL,
	CONSTRAINT "metadata_work_titles" CHECK(json_valid("metadata_works"."titles"))
);
--> statement-breakpoint
CREATE INDEX `metadata_work_filter` ON `metadata_works` (`format`,`year`);--> statement-breakpoint
-- Seed account summaries first, then local summaries, then complete detail snapshots.
-- No business identities, decisions, command receipts or download records are rewritten.
INSERT OR REPLACE INTO metadata_works
SELECT e.media_id, anishelf_provider(e.media_id), anishelf_provider_id(e.media_id),
 COALESCE((SELECT value FROM tracking_list_cache_entries_titles WHERE parent_id=e.row_id ORDER BY ordinal_index LIMIT 1), e.media_id),
 COALESCE((SELECT json_group_array(json_object('value',value,'kind','native','language',NULL)) FROM (SELECT value FROM tracking_list_cache_entries_titles WHERE parent_id=e.row_id ORDER BY ordinal_index)), '[]'),
 e.format,e.year,e.episode_count,e.cover_url,c.fetched_at,0
FROM tracking_list_cache_entries e JOIN tracking_list_cache c ON c.account_id=e.parent_id ORDER BY c.fetched_at;
--> statement-breakpoint
INSERT OR REPLACE INTO metadata_works
SELECT anishelf_work_key(l.provider,l.provider_id),l.provider,l.provider_id,w.provider_title,
 COALESCE((SELECT json_group_array(json_object('value',value,'kind','native','language',NULL)) FROM (SELECT value FROM catalog_works_search_titles WHERE parent_id=w.id ORDER BY ordinal_index)), '[]'),
 w.format,w.year,w.episode_count,json_extract(s.data,'$.coverUrl'),s.fetched_at,0
FROM catalog_works w JOIN catalog_provider_links l ON l.work_id=w.id JOIN metadata_snapshots s ON s.id=l.snapshot_id;
--> statement-breakpoint
INSERT OR REPLACE INTO metadata_works
SELECT anishelf_work_key(json_extract(data,'$.reference.provider'),json_extract(data,'$.reference.id')),
 json_extract(data,'$.reference.provider'),json_extract(data,'$.reference.id'),
 COALESCE((SELECT json_extract(value,'$.value') FROM json_each(json_extract(s.data,'$.titles')) WHERE json_extract(value,'$.kind')='native' LIMIT 1),json_extract(data,'$.titles[0].value'),json_extract(data,'$.reference.id')),
 json_extract(data,'$.titles'),json_extract(data,'$.format'),json_extract(data,'$.year'),json_extract(data,'$.episodeCount'),json_extract(data,'$.coverUrl'),fetched_at,1
FROM metadata_snapshots s WHERE kind='detail' AND json_type(data,'$.reference.id')='text' AND json_type(data,'$.titles')='array' ORDER BY fetched_at,rowid;
--> statement-breakpoint
DROP TABLE `catalog_works_search_titles`;--> statement-breakpoint
DROP TABLE `tracking_list_cache_entries_titles`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_catalog_works` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "catalog_works_revision_0" CHECK("__new_catalog_works"."revision" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_catalog_works`("id", "revision", "created_at", "updated_at") SELECT "id", "revision", "created_at", "updated_at" FROM `catalog_works`;--> statement-breakpoint
DROP TABLE `catalog_works`;--> statement-breakpoint
ALTER TABLE `__new_catalog_works` RENAME TO `catalog_works`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `tracking_list_cache_entries` DROP COLUMN `format`;--> statement-breakpoint
ALTER TABLE `tracking_list_cache_entries` DROP COLUMN `year`;--> statement-breakpoint
ALTER TABLE `tracking_list_cache_entries` DROP COLUMN `episode_count`;--> statement-breakpoint
ALTER TABLE `tracking_list_cache_entries` DROP COLUMN `cover_url`;
--> statement-breakpoint
ALTER TABLE `metadata_works` ADD `detail_snapshot_id` text REFERENCES metadata_snapshots(id);
--> statement-breakpoint
UPDATE metadata_works SET detail_snapshot_id = (
 SELECT id FROM metadata_snapshots s WHERE s.kind='detail'
 AND json_extract(s.data,'$.reference.provider')=metadata_works.provider
 AND json_extract(s.data,'$.reference.id')=metadata_works.provider_id
 ORDER BY fetched_at DESC,rowid DESC LIMIT 1
) WHERE detail=1;
