ALTER TABLE `acquisition_intents` ADD `accepted_target` text;--> statement-breakpoint
ALTER TABLE `catalog_reviews` ADD `decision_origin` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_reviews` ADD `acquisition` text;