CREATE TABLE `tracking_list_cache` (
	`account_id` integer PRIMARY KEY NOT NULL,
	`fetched_at` integer NOT NULL,
	`entries` text NOT NULL
);
