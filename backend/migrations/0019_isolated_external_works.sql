-- Refuse dangling canonical IDs or duplicate source entries within a group.
CREATE TEMP TABLE external_identity_validation (valid INTEGER NOT NULL CONSTRAINT external_identity_integrity_requires_canonical_source_and_unique_provider CHECK (valid = 1));
--> statement-breakpoint
INSERT INTO external_identity_validation SELECT CASE WHEN EXISTS (
 SELECT 1 FROM metadata_references r WHERE NOT EXISTS (
  SELECT 1 FROM metadata_references c WHERE c.id = r.work_id AND c.work_id = r.work_id
 )
) OR EXISTS (
 SELECT 1 FROM metadata_references GROUP BY work_id, provider HAVING count(*) > 1
) THEN 0 ELSE 1 END;
--> statement-breakpoint
CREATE TEMP TABLE external_identity_split AS
SELECT id AS old_id, work_id AS old_work_id, provider, provider_id,
 row_number() OVER (PARTITION BY work_id ORDER BY provider, provider_id) AS ordinal,
 count(*) OVER (PARTITION BY work_id) AS group_size
FROM metadata_references;
--> statement-breakpoint
SELECT anishelf_identity_split(old_work_id, group_size) FROM external_identity_split WHERE ordinal = 1 AND group_size > 1;
--> statement-breakpoint
DELETE FROM metadata_references;
--> statement-breakpoint
INSERT INTO metadata_references (id, work_id, provider, provider_id)
SELECT CASE WHEN ordinal = 1 THEN old_work_id
 WHEN old_id <> old_work_id THEN old_id
 ELSE lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))) END,
 '', provider, provider_id FROM external_identity_split;
--> statement-breakpoint
UPDATE metadata_references SET work_id = id;
--> statement-breakpoint
CREATE UNIQUE INDEX metadata_reference_work_unique ON metadata_references(work_id);
--> statement-breakpoint
-- Build stale source-only evidence where the old source detail cache was evicted.
-- Historical combined documents remain untouched and never become current source content.
INSERT INTO metadata_works (key, provider, provider_id, provider_title, titles, fetched_at, detail)
SELECT anishelf_work_key(r.provider, r.provider_id), r.provider, r.provider_id,
 r.provider || ':' || r.provider_id,
 json_array(json_object('value', r.provider || ':' || r.provider_id, 'kind', 'native', 'language', NULL)), 0, 0
FROM metadata_references r WHERE NOT EXISTS (SELECT 1 FROM metadata_works w WHERE w.provider = r.provider AND w.provider_id = r.provider_id);
--> statement-breakpoint
INSERT INTO metadata_snapshots (id, key, kind, fetched_at, expires_at, accessed_at, failure_present, data)
SELECT 'isolated:' || r.id, 'isolated:' || r.id, 'detail', w.fetched_at, 0, w.fetched_at, 0,
 json_object('reference', json_object('provider', r.provider, 'mediaType', 'anime', 'id', r.provider_id),
 'titles', json(w.titles), 'year', w.year, 'format', w.format, 'status', w.status,
 'episodeCount', w.episode_count, 'nextAiringEpisode', CASE WHEN w.next_airing_episode IS NULL THEN NULL ELSE json_object('episode', w.next_airing_episode, 'airingAt', w.next_airing_at) END,
 'airingSeason', NULL, 'coverUrl', w.cover_url, 'bannerUrl', NULL, 'description', NULL,
 'startDate', NULL, 'endDate', NULL, 'durationMinutes', NULL, 'country', NULL, 'source', NULL,
 'genres', json('[]'), 'tags', json('[]'), 'studios', json('[]'), 'averageScore', NULL,
 'streamingEpisodes', json('[]'), 'episodeCatalog', 'unavailable', 'siteUrl', NULL, 'providerUpdatedAt', NULL,
 'unavailableFields', json('["description","bannerUrl","startDate","endDate","durationMinutes","country","source","genres","tags","studios","averageScore","streamingEpisodes","episodeCatalog"]'))
FROM metadata_references r JOIN metadata_works w ON w.provider = r.provider AND w.provider_id = r.provider_id
WHERE w.detail_snapshot_id IS NULL;
--> statement-breakpoint
UPDATE metadata_works SET detail_snapshot_id = (SELECT 'isolated:' || r.id FROM metadata_references r WHERE r.provider = metadata_works.provider AND r.provider_id = metadata_works.provider_id)
WHERE provider <> 'metadata' AND detail_snapshot_id IS NULL AND EXISTS (SELECT 1 FROM metadata_references r WHERE r.provider = metadata_works.provider AND r.provider_id = metadata_works.provider_id);
--> statement-breakpoint
-- Source indexes and immutable snapshots remain available. Clear composed current summaries.
DELETE FROM metadata_works WHERE provider = 'metadata';
--> statement-breakpoint
INSERT INTO metadata_works (key, provider, provider_id, provider_title, titles, format, year, episode_count, status, next_airing_episode, next_airing_at, cover_url, fetched_at, detail, detail_snapshot_id)
SELECT anishelf_work_key('metadata', r.id), 'metadata', r.id, w.provider_title, w.titles, w.format, w.year, w.episode_count, w.status, w.next_airing_episode, w.next_airing_at, w.cover_url, w.fetched_at, w.detail, w.detail_snapshot_id
FROM metadata_references r JOIN metadata_works w ON w.provider = r.provider AND w.provider_id = r.provider_id;
--> statement-breakpoint
DROP TABLE external_identity_split;
--> statement-breakpoint
DROP TABLE external_identity_validation;
