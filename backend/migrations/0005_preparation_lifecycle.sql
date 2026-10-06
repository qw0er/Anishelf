-- Preserve task/artifact identities and bytes while removing duplicated snapshot identity.
CREATE TABLE preparation_tasks_v3 (
 id text PRIMARY KEY NOT NULL, source_id text NOT NULL REFERENCES media_sources(id) ON DELETE restrict,
 execution_plan_id text NOT NULL, profile_id text NOT NULL, profile_fingerprint text NOT NULL,
 filename text NOT NULL, snapshot text NOT NULL, status text NOT NULL, progress text, failure_reason text,
 created_at_ms integer NOT NULL, updated_at_ms integer NOT NULL,
 CONSTRAINT preparation_status CHECK(status IN ('queued','processing','cancelling','ready','failed','cancelled'))
);
--> statement-breakpoint
INSERT INTO preparation_tasks_v3
SELECT id, source_id, execution_plan_id, profile_id, profile_fingerprint, filename,
 CASE WHEN json_extract(snapshot, '$.version') = 1 THEN snapshot ELSE
 json_object('version',1,'mode',json_extract(snapshot,'$.mode'),'reasons',json_extract(snapshot,'$.reasons'),
 'videoStreamIndex',json_extract(snapshot,'$.request.videoStreamIndex'),
 'audioStreamIndices',json_extract(snapshot,'$.request.audioStreamIndices'),
 'plan',json_remove(json_extract(snapshot,'$.request.plan'),'$.id')) END,
 status, progress, failure_reason, created_at_ms, updated_at_ms FROM preparation_tasks;
--> statement-breakpoint
CREATE TABLE prepared_artifacts_v3 (
 id text PRIMARY KEY NOT NULL, task_id text NOT NULL REFERENCES preparation_tasks_v3(id) ON DELETE restrict,
 size_bytes integer NOT NULL CHECK(size_bytes > 0), mime_type text NOT NULL
);
--> statement-breakpoint
INSERT INTO prepared_artifacts_v3 SELECT * FROM prepared_artifacts;
--> statement-breakpoint
DROP TABLE prepared_artifacts;
--> statement-breakpoint
DROP TABLE preparation_tasks;
--> statement-breakpoint
ALTER TABLE preparation_tasks_v3 RENAME TO preparation_tasks;
--> statement-breakpoint
ALTER TABLE prepared_artifacts_v3 RENAME TO prepared_artifacts;
--> statement-breakpoint
CREATE INDEX preparation_queue ON preparation_tasks(status,updated_at_ms,id);
--> statement-breakpoint
CREATE INDEX preparation_source ON preparation_tasks(source_id);

--> statement-breakpoint
CREATE UNIQUE INDEX preparation_tasks_execution_plan_id_unique ON preparation_tasks(execution_plan_id);
--> statement-breakpoint
CREATE UNIQUE INDEX prepared_artifacts_task_id_unique ON prepared_artifacts(task_id);
