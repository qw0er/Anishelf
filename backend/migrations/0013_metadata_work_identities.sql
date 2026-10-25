CREATE TABLE `metadata_references` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_reference_source` ON `metadata_references` (`provider`,`provider_id`);