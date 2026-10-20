CREATE TABLE `acquisition_authorizations` (
	`work_key` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `acquisition_destination` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `acquisition_directories` (
	`work_key` text PRIMARY KEY NOT NULL,
	`directory` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_directories_directory_unique` ON `acquisition_directories` (`directory`);--> statement-breakpoint
CREATE TABLE `acquisition_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`work_key` text NOT NULL,
	`episode` text NOT NULL,
	`hash` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_episode_reservation` ON `acquisition_intents` (`work_key`,`episode`);--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_hash_reservation` ON `acquisition_intents` (`hash`);--> statement-breakpoint
CREATE INDEX `acquisition_intents_work` ON `acquisition_intents` (`work_key`);