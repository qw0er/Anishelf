-- Preserve immutable projections and their pinned identities while replacing ordered child tables.
CREATE TABLE metadata_snapshot_payloads AS SELECT m.id, CASE m.kind WHEN 'detail' THEN (CASE WHEN m."detail_present" THEN json_object('unavailableFields', json((SELECT json_group_array(value) FROM (SELECT c0."value" AS value FROM "metadata_snapshots_detail_unavailable_fields" c0 WHERE c0."parent_id" = m."id" ORDER BY c0."ordinal_index"))), 'reference', json_object('provider', m."detail_reference_provider", 'mediaType', m."detail_reference_media_type", 'id', m."detail_reference_id"), 'titles', json((SELECT json_group_array(json(value)) FROM (SELECT json_object('value', c1."value", 'language', c1."language", 'kind', c1."kind") AS value FROM "metadata_snapshots_detail_titles" c1 WHERE c1."parent_id" = m."id" ORDER BY c1."ordinal_index"))), 'year', m."detail_year", 'format', m."detail_format", 'status', m."detail_status", 'episodeCount', m."detail_episode_count", 'airingSeason', m."detail_airing_season", 'coverUrl', m."detail_cover_url", 'description', m."detail_description", 'bannerUrl', m."detail_banner_url", 'startDate', (CASE WHEN m."detail_start_date_present" THEN json_object('year', m."detail_start_date_year", 'month', m."detail_start_date_month", 'day', m."detail_start_date_day") ELSE NULL END), 'endDate', (CASE WHEN m."detail_end_date_present" THEN json_object('year', m."detail_end_date_year", 'month', m."detail_end_date_month", 'day', m."detail_end_date_day") ELSE NULL END), 'durationMinutes', m."detail_duration_minutes", 'country', m."detail_country", 'source', m."detail_source", 'genres', json((SELECT json_group_array(value) FROM (SELECT c2."value" AS value FROM "metadata_snapshots_detail_genres" c2 WHERE c2."parent_id" = m."id" ORDER BY c2."ordinal_index"))), 'tags', json((SELECT json_group_array(json(value)) FROM (SELECT json_object('name', c3."name", 'rank', c3."rank", 'spoiler', json(CASE WHEN c3."spoiler" THEN 'true' ELSE 'false' END)) AS value FROM "metadata_snapshots_detail_tags" c3 WHERE c3."parent_id" = m."id" ORDER BY c3."ordinal_index"))), 'studios', json((SELECT json_group_array(json(value)) FROM (SELECT json_object('id', c4."id", 'name', c4."name") AS value FROM "metadata_snapshots_detail_studios" c4 WHERE c4."parent_id" = m."id" ORDER BY c4."ordinal_index"))), 'averageScore', m."detail_average_score", 'siteUrl', m."detail_site_url", 'providerUpdatedAt', m."detail_provider_updated_at", 'streamingEpisodes', json((SELECT json_group_array(json(value)) FROM (SELECT json_object('title', c5."title", 'url', c5."url", 'site', c5."site", 'thumbnail', c5."thumbnail") AS value FROM "metadata_snapshots_detail_streaming_episodes" c5 WHERE c5."parent_id" = m."id" ORDER BY c5."ordinal_index"))), 'episodeCatalog', m."detail_episode_catalog") ELSE NULL END) ELSE json_object('items', json(CASE m.kind WHEN 'search' THEN json((SELECT json_group_array(json(value)) FROM (SELECT json_object('unavailableFields', json((SELECT json_group_array(value) FROM (SELECT c7."value" AS value FROM "metadata_snapshots_items_unavailable_fields" c7 WHERE c7."parent_id" = c6."row_id" ORDER BY c7."ordinal_index"))), 'reference', json_object('provider', c6."reference_provider", 'mediaType', c6."reference_media_type", 'id', c6."reference_id"), 'titles', json((SELECT json_group_array(json(value)) FROM (SELECT json_object('value', c8."value", 'language', c8."language", 'kind', c8."kind") AS value FROM "metadata_snapshots_items_titles" c8 WHERE c8."parent_id" = c6."row_id" ORDER BY c8."ordinal_index"))), 'year', c6."year", 'format', c6."format", 'status', c6."status", 'episodeCount', c6."episode_count", 'airingSeason', c6."airing_season", 'coverUrl', c6."cover_url") AS value FROM "metadata_snapshots_items" c6 WHERE c6."parent_id" = m."id" ORDER BY c6."ordinal_index"))) WHEN 'relations' THEN json((SELECT json_group_array(json(value)) FROM (SELECT json_object('type', c9."type", 'work', json_object('unavailableFields', json((SELECT json_group_array(value) FROM (SELECT c10."value" AS value FROM "metadata_snapshots_relations_work_unavailable_fields" c10 WHERE c10."parent_id" = c9."row_id" ORDER BY c10."ordinal_index"))), 'reference', json_object('provider', c9."work_reference_provider", 'mediaType', c9."work_reference_media_type", 'id', c9."work_reference_id"), 'titles', json((SELECT json_group_array(json(value)) FROM (SELECT json_object('value', c11."value", 'language', c11."language", 'kind', c11."kind") AS value FROM "metadata_snapshots_relations_work_titles" c11 WHERE c11."parent_id" = c9."row_id" ORDER BY c11."ordinal_index"))), 'year', c9."work_year", 'format', c9."work_format", 'status', c9."work_status", 'episodeCount', c9."work_episode_count", 'airingSeason', c9."work_airing_season", 'coverUrl', c9."work_cover_url")) AS value FROM "metadata_snapshots_relations" c9 WHERE c9."parent_id" = m."id" ORDER BY c9."ordinal_index"))) ELSE json((SELECT json_group_array(json(value)) FROM (SELECT json_object('id', c12."id", 'episode', c12."episode", 'airingAt', c12."airing_at") AS value FROM "metadata_snapshots_airing" c12 WHERE c12."parent_id" = m."id" ORDER BY c12."ordinal_index"))) END), 'page', coalesce(m.page,1), 'perPage', coalesce(m.per_page,50), 'hasNextPage', json(CASE WHEN m.has_next_page THEN 'true' ELSE 'false' END)) END AS data FROM metadata_snapshots m;
--> statement-breakpoint
DROP TABLE "metadata_snapshots_relations_work_unavailable_fields";
--> statement-breakpoint
DROP TABLE "metadata_snapshots_relations_work_titles";
--> statement-breakpoint
DROP TABLE "metadata_snapshots_relations";
--> statement-breakpoint
DROP TABLE "metadata_snapshots_items_unavailable_fields";
--> statement-breakpoint
DROP TABLE "metadata_snapshots_items_titles";
--> statement-breakpoint
DROP TABLE "metadata_snapshots_items";
--> statement-breakpoint
DROP TABLE "metadata_snapshots_detail_unavailable_fields";
--> statement-breakpoint
DROP TABLE "metadata_snapshots_detail_titles";
--> statement-breakpoint
DROP TABLE "metadata_snapshots_detail_tags";
--> statement-breakpoint
DROP TABLE "metadata_snapshots_detail_studios";
--> statement-breakpoint
DROP TABLE "metadata_snapshots_detail_streaming_episodes";
--> statement-breakpoint
DROP TABLE "metadata_snapshots_detail_genres";
--> statement-breakpoint
DROP TABLE "metadata_snapshots_airing";
--> statement-breakpoint
CREATE TABLE __new_metadata_snapshots (id TEXT PRIMARY KEY NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('search','detail','relations','airing')), fetched_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, accessed_at INTEGER NOT NULL, failure_present INTEGER NOT NULL CHECK(failure_present IN(0,1)), failure_code TEXT, failure_message TEXT, failure_retry_at INTEGER, data TEXT NOT NULL CHECK(json_valid(data)), CHECK(failure_present = 0 OR (failure_code IS NOT NULL AND failure_message IS NOT NULL)));
--> statement-breakpoint
INSERT INTO __new_metadata_snapshots SELECT m.id,m.key,m.kind,m.fetched_at,m.expires_at,m.accessed_at,m.failure_present,m.failure_code,m.failure_message,m.failure_retry_at,p.data FROM metadata_snapshots m JOIN metadata_snapshot_payloads p ON p.id=m.id;
--> statement-breakpoint
DROP TABLE metadata_snapshots;
--> statement-breakpoint
ALTER TABLE __new_metadata_snapshots RENAME TO metadata_snapshots;
--> statement-breakpoint
CREATE INDEX metadata_cache_key ON metadata_snapshots(key,fetched_at);
--> statement-breakpoint
CREATE INDEX metadata_lru ON metadata_snapshots(kind,accessed_at);
--> statement-breakpoint
DROP TABLE metadata_snapshot_payloads;

--> statement-breakpoint
CREATE TABLE media_inspections (scope_id TEXT NOT NULL, file_id TEXT NOT NULL, source_version TEXT NOT NULL, format_version TEXT NOT NULL, info TEXT NOT NULL, PRIMARY KEY(scope_id,file_id), CONSTRAINT media_inspection_info CHECK(json_valid(info)));
