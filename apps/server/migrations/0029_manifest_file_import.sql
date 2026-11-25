ALTER TABLE `acquisition_episode_claims` ADD `association_review` text;--> statement-breakpoint
ALTER TABLE `acquisition_transfer_file_targets` ADD `declined` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `acquisition_transfer_files` ADD `progress` real;