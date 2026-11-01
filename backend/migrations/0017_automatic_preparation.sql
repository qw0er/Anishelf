ALTER TABLE preparation_tasks ADD COLUMN extended_snapshot TEXT CHECK (extended_snapshot IS NULL OR json_valid(extended_snapshot));
--> statement-breakpoint
ALTER TABLE preparation_tasks ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'automatic'));
--> statement-breakpoint
ALTER TABLE preparation_tasks ADD COLUMN preset_id TEXT;
--> statement-breakpoint
ALTER TABLE preparation_tasks ADD COLUMN preset_fingerprint TEXT;
--> statement-breakpoint
CREATE TABLE automatic_preparation_demands (
 id TEXT PRIMARY KEY NOT NULL,
 failures INTEGER NOT NULL CHECK (failures >= 0),
 next_attempt_at_ms INTEGER NOT NULL CHECK (next_attempt_at_ms >= 0),
 task_updated_at_ms INTEGER
);
