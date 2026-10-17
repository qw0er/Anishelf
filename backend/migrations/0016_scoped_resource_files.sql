-- Scope file lookup IDs without changing durable source primary keys or foreign keys.
UPDATE media_sources
SET file_id = scoped_resource_file_id(root_id, relative_path)
WHERE file_id = legacy_resource_file_id(relative_path);
--> statement-breakpoint
UPDATE catalog_reviews
SET result = json_set(result, '$.source.fileId', (SELECT file_id FROM media_sources WHERE media_sources.id = catalog_reviews.id))
WHERE json_valid(result) AND json_type(result, '$.source') = 'object';
--> statement-breakpoint
-- Keep durable observation/command contexts bound to the same source after lookup-ID upgrade.
UPDATE playback_completions
SET context = json_set(context, '$.fileId', (SELECT file_id FROM media_sources WHERE media_sources.id = playback_completions.source_id))
WHERE CASE WHEN json_valid(context) THEN json_extract(context, '$.reviewId') = source_id ELSE 0 END;
--> statement-breakpoint
UPDATE tracking_operations
SET operation = json_set(operation, '$.target.fileId', (SELECT file_id FROM media_sources WHERE media_sources.id = json_extract(operation, '$.target.reviewId')))
WHERE CASE WHEN json_valid(operation) THEN EXISTS (
 SELECT 1 FROM media_sources
 WHERE media_sources.id = json_extract(operation, '$.target.reviewId')
 AND media_sources.source_version = json_extract(operation, '$.target.sourceVersion')
) ELSE 0 END;
