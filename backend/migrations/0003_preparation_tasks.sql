CREATE TABLE `preparation_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`execution_plan_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`profile_fingerprint` text NOT NULL,
	`filename` text NOT NULL,
	`snapshot` text NOT NULL,
	`status` text NOT NULL,
	`progress` text,
	`failure_reason` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "preparation_status" CHECK("preparation_tasks"."status" IN ('queued', 'processing', 'ready', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preparation_tasks_execution_plan_id_unique` ON `preparation_tasks` (`execution_plan_id`);--> statement-breakpoint
CREATE INDEX `preparation_queue` ON `preparation_tasks` (`status`,`created_at_ms`);--> statement-breakpoint
CREATE INDEX `preparation_source` ON `preparation_tasks` (`source_id`);--> statement-breakpoint
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