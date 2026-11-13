ALTER TABLE preparation_tasks ADD COLUMN snapshot_plan_preserve_subtitles integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE preparation_tasks SET status = 'cancelled', failure_reason = 'cancelled' WHERE origin = 'automatic' AND status IN ('queued', 'processing', 'cancelling');
--> statement-breakpoint
DROP TABLE IF EXISTS automatic_preparation_demands;
--> statement-breakpoint
DELETE FROM subtitle_font_assets;
--> statement-breakpoint
DELETE FROM subtitle_font_sets_warnings;
--> statement-breakpoint
DELETE FROM subtitle_font_sets;
--> statement-breakpoint
DELETE FROM subtitle_assets;
