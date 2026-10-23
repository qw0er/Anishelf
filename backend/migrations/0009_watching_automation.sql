CREATE TABLE `acquisition_watching_members` (
	`account_id` text NOT NULL,
	`work_key` text NOT NULL,
	`revision` text NOT NULL,
	`title` text NOT NULL,
	`excluded` integer NOT NULL,
	`paused` integer NOT NULL,
	`subscription_revision` text,
	`grant_id` text,
	`start_episode` integer,
	`reason` text NOT NULL,
	`retry_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `work_key`),
	CONSTRAINT "acquisition_watching_excluded" CHECK("acquisition_watching_members"."excluded" IN (0,1)),
	CONSTRAINT "acquisition_watching_paused" CHECK("acquisition_watching_members"."paused" IN (0,1)),
	CONSTRAINT "acquisition_watching_start" CHECK("acquisition_watching_members"."start_episode" IS NULL OR "acquisition_watching_members"."start_episode" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acquisition_watching_owner` ON `acquisition_watching_members` (`work_key`) WHERE "acquisition_watching_members"."subscription_revision" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `acquisition_watching_policy` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT "acquisition_watching_policy_singleton" CHECK("acquisition_watching_policy"."id" = 'default')
);
