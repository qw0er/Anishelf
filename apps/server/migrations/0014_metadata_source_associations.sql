CREATE TABLE `__new_metadata_references` (
 `id` text PRIMARY KEY NOT NULL,
 `provider` text NOT NULL,
 `provider_id` text NOT NULL,
 `work_id` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_metadata_references` (`id`, `provider`, `provider_id`, `work_id`) SELECT `id`, `provider`, `provider_id`, `id` FROM `metadata_references`;
--> statement-breakpoint
DROP TABLE `metadata_references`;
--> statement-breakpoint
ALTER TABLE `__new_metadata_references` RENAME TO `metadata_references`;
--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_reference_source` ON `metadata_references` (`provider`,`provider_id`);
--> statement-breakpoint
CREATE INDEX `metadata_reference_work` ON `metadata_references` (`work_id`);
