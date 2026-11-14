import { randomUUID } from "node:crypto";
import { DomainError } from "../../../../shared/errors.js";
import type { SaveSubscriptionInput, Subscription } from "../domain/model.js";
import {
	acquisitionProfileFingerprint,
	builtinAcquisitionProfiles,
	defaultAcquisitionProfileId,
} from "../domain/profiles.js";
import type { SubscriptionsOptions } from "./context.js";

export const maximumSubscriptions = 64;

export function saveSubscription(
	options: Pick<
		SubscriptionsOptions,
		| "store"
		| "profiles"
		| "defaultProfileId"
		| "downloadTarget"
		| "sources"
		| "logger"
	>,
	input: SaveSubscriptionInput,
	commit?: (subscription: Subscription) => void,
): void {
	if (
		!Number.isSafeInteger(input.startEpisode) ||
		input.startEpisode < 1 ||
		input.startEpisode > 10000
	)
		throw new DomainError("INVALID_REQUEST", "Invalid starting episode.");
	const current = options.store.subscription(input.workKey);
	if ((current?.revision ?? null) !== input.revision)
		throw new DomainError(
			"ACQUISITION_CONFLICT",
			"Subscription changed. Refresh and retry.",
		);
	if (!current && options.store.subscriptions().length >= maximumSubscriptions)
		throw new DomainError(
			"ACQUISITION_UNAVAILABLE",
			"Subscription limit reached.",
		);
	const profileId = input.profileId ?? null;
	const requestedProfileId =
		profileId ?? options.defaultProfileId?.() ?? defaultAcquisitionProfileId;
	const selectedProfile = (options.profiles ?? builtinAcquisitionProfiles).find(
		(profile) => profile.id === requestedProfileId,
	);
	if (!selectedProfile)
		throw new DomainError(
			"INVALID_REQUEST",
			"The acquisition profile is unavailable. Choose an existing profile.",
		);

	const target = input.target;
	const destination = options.downloadTarget?.();
	if (
		target &&
		(!destination?.validated ||
			destination.revision !== target.destinationRevision ||
			destination.connectionGeneration !== target.connectionGeneration)
	)
		throw new DomainError(
			"ACQUISITION_CONFLICT",
			"Configure and validate the current download destination, then save again.",
		);
	const automatic =
		input.source?.kind === "automatic" ||
		(!input.source && !current) ||
		(!input.source && !!current?.automatic && !current.feedId);
	const settings = options.sources.connector.settings();
	if (automatic && (!settings.ready || !settings.providers.length))
		throw new DomainError(
			"ACQUISITION_UNAVAILABLE",
			"Configure source sites in Settings first.",
		);
	const subscription: Subscription = {
		workKey: input.workKey,
		feedId: automatic ? null : (current?.feedId ?? null),
		sourceInput:
			automatic || input.source?.kind === "automatic"
				? null
				: (input.source ?? current?.sourceInput ?? null),
		...(current?.discovery && !automatic
			? { discovery: current.discovery }
			: {}),
		// A save from the work editor explicitly takes manual ownership.
		...(current?.completion && current.startEpisode === input.startEpisode
			? { completion: current.completion }
			: {}),
		...(automatic
			? {
					automatic: {
						sourceGeneration: settings.generation,
						profileFingerprint: acquisitionProfileFingerprint(selectedProfile),
						target,
						retryAt: 0,
					},
				}
			: {}),
		startEpisode: input.startEpisode,
		profileId,
		enabled: current?.enabled ?? true,
		revision: randomUUID(),
	};
	try {
		options.store.transaction(() => {
			if (!automatic) {
				const source = subscription.sourceInput ?? subscription.feedId;
				const snapshot = source ? options.sources.snapshot(source) : null;
				if (!snapshot)
					throw new DomainError("INVALID_REQUEST", "Choose a source.");
				subscription.feedId = snapshot.id;
			}
			if (commit) commit(subscription);
			// Preserve existing selection clocks on a configuration edit; changed profiles are fenced until reevaluation.
			options.store.saveSubscription(
				subscription,
				current?.feedId === subscription.feedId
					? options.store.candidates(input.workKey)
					: [],
			);
			if (target && subscription.feedId)
				options.store.authorize({
					workKey: subscription.workKey,
					feedId: subscription.feedId,
					startEpisode: subscription.startEpisode,
					...target,
				});
			else options.store.revoke(subscription.workKey);
		});
	} catch (error) {
		options.logger.warn(
			{
				event: "acquisition.subscription_save_failed",
				workKey: input.workKey,
			},
			"Subscription and permission were rolled back.",
		);
		throw error;
	}
	options.logger.info(
		{
			event:
				current?.createdBy === "watching" && !commit
					? "acquisition.subscription_taken_over"
					: "acquisition.subscription_saved",
			workKey: subscription.workKey,
			sourceId: subscription.feedId,
			revision: subscription.revision,
			acquisitionEnabled: Boolean(target),
		},
		"Subscription saved; source collection will run in the background.",
	);
}
