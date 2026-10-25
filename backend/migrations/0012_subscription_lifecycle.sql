ALTER TABLE `acquisition_subscriptions` ADD `watching_account_id` text;--> statement-breakpoint
ALTER TABLE `acquisition_subscriptions` ADD `completion` text;--> statement-breakpoint
-- Prefer an unambiguous recorded member. A grant only binds records with no member.
UPDATE acquisition_subscriptions
SET watching_account_id = CASE
  WHEN (SELECT COUNT(*) FROM acquisition_watching_members m WHERE m.work_key = acquisition_subscriptions.work_key) = 1
    THEN (SELECT account_id FROM acquisition_watching_members m WHERE m.work_key = acquisition_subscriptions.work_key)
  WHEN NOT EXISTS (SELECT 1 FROM acquisition_watching_members m WHERE m.work_key = acquisition_subscriptions.work_key)
    THEN (SELECT json_extract(value, '$.grant.accountId') FROM acquisition_watching_policy WHERE id = 'default')
  ELSE NULL END
WHERE created_by = 'watching';
--> statement-breakpoint
-- Preserve an old individual pause as a group exclusion.
UPDATE acquisition_watching_members SET excluded = 1, paused = 0
WHERE work_key IN (SELECT work_key FROM acquisition_subscriptions WHERE created_by = 'watching' AND enabled = 0);
--> statement-breakpoint
UPDATE acquisition_subscriptions SET enabled = 1
WHERE created_by = 'watching' AND watching_account_id IS NOT NULL
AND EXISTS (SELECT 1 FROM acquisition_watching_members m WHERE m.work_key = acquisition_subscriptions.work_key AND m.account_id = acquisition_subscriptions.watching_account_id);
