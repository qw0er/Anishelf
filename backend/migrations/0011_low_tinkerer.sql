CREATE TABLE `tracking_connection` (
	`id` integer PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`account_id` integer,
	`account_name` text,
	`credential_id` text,
	`state` text NOT NULL,
	`checked_at` integer
);
