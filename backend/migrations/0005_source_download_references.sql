CREATE TABLE `acquisition_source_downloads` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`generation` text,
	`descriptor` text NOT NULL
);

--> statement-breakpoint
-- Preserve accepted RSS intents while moving their private URLs behind Sources.
INSERT INTO acquisition_source_downloads (id, source_id, generation, descriptor)
SELECT 'legacy:' || id, 'legacy', NULL,
 CASE WHEN source LIKE 'magnet:?%' THEN json_object('kind', 'magnet', 'uri', source)
 ELSE json_object('kind', 'public-torrent', 'url', source) END
FROM acquisition_intents
WHERE source LIKE 'magnet:?%' OR source LIKE 'https://%' OR source LIKE 'http://%';
--> statement-breakpoint
UPDATE acquisition_intents SET source = 'legacy:' || id
WHERE source LIKE 'magnet:?%' OR source LIKE 'https://%' OR source LIKE 'http://%';
