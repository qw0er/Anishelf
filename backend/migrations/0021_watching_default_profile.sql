-- Profile choice is policy, not part of Watching download authorization.
UPDATE acquisition_subscriptions
SET profile_id = NULL,
    automatic = CASE WHEN automatic IS NULL THEN NULL ELSE json_remove(automatic, '$.profileFingerprint') END
WHERE created_by = 'watching';
--> statement-breakpoint
UPDATE acquisition_watching_policy
SET value = json_remove(value, '$.grant.profileId', '$.grant.profileFingerprint');
