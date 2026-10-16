CREATE TABLE `tracking_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`media_id` integer NOT NULL,
	`operation` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_operations_account_media` ON `tracking_operations` (`account_id`,`media_id`);--> statement-breakpoint
ALTER TABLE `tracking_list_cache` ADD `invalidated` integer DEFAULT false NOT NULL;