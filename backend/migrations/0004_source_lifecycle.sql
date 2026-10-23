CREATE TABLE `acquisition_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`binding` text NOT NULL,
	`enabled` integer NOT NULL,
	`failures` integer NOT NULL,
	`snapshot` text
);
