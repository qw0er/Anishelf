CREATE TABLE `acquisition_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`work_key` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`work_key`) REFERENCES `acquisition_subscriptions`(`work_key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `acquisition_candidates_work` ON `acquisition_candidates` (`work_key`);--> statement-breakpoint
CREATE TABLE `acquisition_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `acquisition_subscriptions` (
	`work_key` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`feed_id`) REFERENCES `acquisition_feeds`(`id`) ON UPDATE no action ON DELETE no action
);
