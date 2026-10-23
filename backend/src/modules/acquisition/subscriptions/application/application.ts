import { randomUUID } from "node:crypto";
import { DomainError } from "../../../../shared/errors.js";
import { workReference } from "../../../../shared/external-reference.js";
import type { AcquisitionTarget } from "../../../anime/public.js";
import type { SourceSnapshot } from "../../sources/public.js";
import type {
	Candidate,
	SaveSubscriptionInput,
	Subscription,
	SubscriptionView,
} from "../domain/model.js";
import {
	acquisitionProfileFingerprint,
	builtinAcquisitionProfiles,
	defaultAcquisitionProfileId,
} from "../domain/profiles.js";
import { selectCandidates } from "../domain/selection.js";
import type { SubscriptionsApi } from "../public.js";
import { SubscriptionsContext, type SubscriptionsOptions } from "./context.js";
import { subscriptionPolicy as policy } from "./policy.js";
import { SubscriptionWorker } from "./worker.js";

function conflict(): never {
	throw new DomainError(
		"ACQUISITION_CONFLICT",
		"Subscription changed. Refresh and retry.",
	);
}
export class SubscriptionsApplication implements SubscriptionsApi {
	private readonly context: SubscriptionsContext;
	private readonly worker: SubscriptionWorker;
	constructor(private readonly options: SubscriptionsOptions) {
		this.context = new SubscriptionsContext(options);
		this.worker = new SubscriptionWorker(
			this.context,
			(subscription, feed, target) =>
				this.evaluateCandidates(subscription, feed, target),
		);
	}
	private key(value: string) {
		this.context.open();
		try {
			workReference(value);
		} catch {
			throw new DomainError("INVALID_REQUEST", "Invalid anime reference.");
		}
	}
	profiles() {
		const selectedProfileId =
			this.options.defaultProfileId?.() ?? defaultAcquisitionProfileId;
		const profiles = this.options.profiles ?? builtinAcquisitionProfiles;
		return {
			profiles: profiles.map((profile) => ({
				id: profile.id,
				name: profile.name,
				description: profile.description ?? "",
				source: profile.id.startsWith("builtin:")
					? ("builtin" as const)
					: ("custom" as const),
			})),
			selectedProfileId,
			selectionAvailable: profiles.some(
				(profile) => profile.id === selectedProfileId,
			),
		};
	}
	get(workKey: string, page = 1): SubscriptionView {
		this.key(workKey);
		if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
			throw new DomainError("INVALID_REQUEST", "Invalid candidate page.");
		const subscription = this.options.store.subscription(workKey);
		const feed = subscription
			? (this.options.sources.snapshot(subscription.feedId) ??
				this.options.sources.snapshot(
					subscription.sourceInput ?? subscription.feedId,
				))
			: null;
		const candidates = this.options.store
			.candidates(workKey)
			.sort(
				(a, b) =>
					(a.episode ?? Infinity) - (b.episode ?? Infinity) ||
					a.id.localeCompare(b.id),
			);
		return {
			subscription:
				subscription && feed
					? {
							workKey: subscription.workKey,
							feedId: subscription.feedId,
							startEpisode: subscription.startEpisode,
							profileId: subscription.profileId ?? null,
							enabled: subscription.enabled,
							revision: subscription.revision,
							source: feed.label,
							checkedAt: feed.checkedAt,
							nextAttemptAt: feed.nextAttemptAt,
							error: feed.error ?? subscription.lastError ?? null,
						}
					: null,
			candidates: candidates.slice(
				(page - 1) * policy.pageSize,
				page * policy.pageSize,
			),
			total: candidates.length,
			page,
		};
	}
	async save(input: SaveSubscriptionInput): Promise<SubscriptionView> {
		this.key(input.workKey);
		if (
			!Number.isSafeInteger(input.startEpisode) ||
			input.startEpisode < 1 ||
			input.startEpisode > 10000
		)
			throw new DomainError("INVALID_REQUEST", "Invalid starting episode.");
		const current = this.options.store.subscription(input.workKey);
		if ((current?.revision ?? null) !== input.revision) conflict();
		if (
			!current &&
			this.options.store.subscriptions().length >= policy.maximumSubscriptions
		)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Subscription limit reached.",
			);
		const profileId = input.profileId ?? null;
		if (
			!(this.options.profiles ?? builtinAcquisitionProfiles).some(
				(profile) =>
					profile.id === (profileId ?? this.profiles().selectedProfileId),
			)
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"The acquisition profile is unavailable. Choose an existing profile.",
			);
		if (!input.source && !current)
			throw new DomainError("INVALID_REQUEST", "Choose a source.");

		const target = input.target;
		const destination = this.options.downloadTarget?.();
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
		const subscription: Subscription = {
			workKey: input.workKey,
			feedId: current?.feedId ?? "",
			sourceInput: input.source ?? current?.sourceInput ?? null,
			startEpisode: input.startEpisode,
			profileId,
			enabled: true,
			revision: randomUUID(),
		};
		try {
			this.options.store.transaction(() => {
				const snapshot = this.options.sources.snapshot(
					subscription.sourceInput ?? subscription.feedId,
				);
				if (!snapshot)
					throw new DomainError("INVALID_REQUEST", "Choose a source.");
				subscription.feedId = snapshot.id;
				// Preserve existing selection clocks on a configuration edit; changed profiles are fenced until reevaluation.
				this.options.store.saveSubscription(
					subscription,
					current?.feedId === subscription.feedId
						? this.options.store.candidates(input.workKey)
						: [],
				);
				if (target)
					this.options.store.authorize({
						workKey: subscription.workKey,
						feedId: subscription.feedId,
						startEpisode: subscription.startEpisode,
						...target,
					});
				else this.options.store.revoke(subscription.workKey);
			});
		} catch (error) {
			this.options.logger.warn(
				{
					event: "acquisition.subscription_save_failed",
					workKey: input.workKey,
				},
				"Subscription and permission were rolled back.",
			);
			throw error;
		}
		this.options.logger.info(
			{
				event: "acquisition.subscription_saved",
				workKey: subscription.workKey,
				sourceId: subscription.feedId,
				revision: subscription.revision,
				acquisitionEnabled: Boolean(target),
			},
			"Subscription saved; source collection will run in the background.",
		);
		return this.get(input.workKey);
	}
	async setEnabled(workKey: string, revision: string, enabled: boolean) {
		this.key(workKey);
		const current = this.options.store.subscription(workKey);
		if (!current || current.revision !== revision) conflict();
		const feed = this.options.sources.snapshot(
			current.sourceInput ?? current.feedId,
		);
		if (!feed) conflict();
		this.options.store.saveSubscription(
			{ ...current, enabled, revision: randomUUID() },
			this.options.store.candidates(workKey),
		);
		this.options.logger.info(
			{ event: "acquisition.subscription_toggled", enabled, feedId: feed.id },
			"Subscription state changed.",
		);
		return this.get(workKey);
	}
	async remove(workKey: string, revision: string) {
		this.key(workKey);
		if (!this.options.store.remove(workKey, revision)) conflict();
		this.options.logger.info(
			{ event: "acquisition.subscription_removed" },
			"Subscription removed.",
		);
	}
	refresh(workKey: string, revision: string) {
		return this.context.tracked(async () => {
			this.key(workKey);
			const subscription = this.options.store.subscription(workKey);
			if (!subscription?.enabled || subscription.revision !== revision)
				conflict();
			const feed = this.options.sources.snapshot(
				subscription.sourceInput ?? subscription.feedId,
			);
			if (!feed) conflict();
			if (
				feed.checkedAt !== null &&
				this.context.now() - feed.checkedAt < 30_000
			)
				return this.get(workKey);
			await this.worker.pollSource(feed);
			return this.get(workKey);
		});
	}

	private async evaluateCandidates(
		subscription: Subscription,
		feed: SourceSnapshot,
		target: AcquisitionTarget,
	): Promise<Candidate[]> {
		let hashes: string[] | null = null,
			downloadsUnknown = false;
		try {
			hashes = await this.options.downloads(this.context.signal);
		} catch {
			downloadsUnknown = true;
		}
		const current = this.options.store.subscription(subscription.workKey);
		const history =
			current?.feedId === subscription.feedId
				? this.options.store.candidates(subscription.workKey)
				: [];
		const profileId =
			subscription.profileId ?? this.profiles().selectedProfileId;
		const candidates = selectCandidates({
			history,
			now: this.context.now(),
			locked: new Set(
				this.options.lockedCandidates?.(subscription.workKey) ?? [],
			),
			profile:
				(this.options.profiles ?? builtinAcquisitionProfiles).find(
					(profile) => profile.id === profileId,
				) ?? null,
			subscription,
			feed,
			target,
			downloadsUnknown,
			active: new Set(hashes ?? []),
			assessReleaseTitle: (title, work) =>
				this.options.anime.assessReleaseTitle(title, work),
		});
		for (const candidate of candidates) {
			const prior = history.find((other) => other.id === candidate.id);
			if (JSON.stringify(prior) !== JSON.stringify(candidate))
				this.options.logger.info(
					{
						event: "acquisition.release_decided",
						workKey: subscription.workKey,
						candidateId: candidate.id,
						episode: candidate.episode,
						status: candidate.status,
						reasons: candidate.reasons,
						...candidate.selection,
					},
					"Release selection evaluated.",
				);
		}
		return candidates;
	}
	/** Subscriptions exposes read-only selection and permission capabilities to Downloads. */
	selection() {
		return {
			subscription: (workKey: string) =>
				this.options.store.subscription(workKey),
			subscriptions: () => this.options.store.subscriptions(),
			candidates: (workKey: string) => {
				const subscription = this.options.store.subscription(workKey);
				const profile = (
					this.options.profiles ?? builtinAcquisitionProfiles
				).find(
					(profile) =>
						profile.id ===
						(subscription?.profileId ?? this.profiles().selectedProfileId),
				);
				const locked = new Set(this.options.lockedCandidates?.(workKey) ?? []);
				return this.options.store.candidates(workKey).map((candidate) =>
					locked.has(candidate.id) ||
					(profile &&
						candidate.selection?.fingerprint ===
							acquisitionProfileFingerprint(profile))
						? candidate
						: {
								...candidate,
								status: "skipped" as const,
								reasons: ["profile_unavailable"],
							},
				);
			},
			release: (feedId: string, entryId: string) =>
				this.options.sources
					.snapshot(feedId)
					?.entries.find((entry) => entry.id === entryId) ?? null,
			authorization: (key: string) => this.options.store.authorization(key),
		};
	}
	activeSourceIds() {
		return this.options.store
			.subscriptions()
			.filter((subscription) => subscription.enabled)
			.map((subscription) => subscription.feedId);
	}
	refreshSource(id: string) {
		const subscription = this.options.store
			.subscriptions()
			.find((item) => item.enabled && item.feedId === id);
		const snapshot = subscription
			? this.options.sources.snapshot(subscription.sourceInput ?? id)
			: null;
		return snapshot ? this.worker.pollSource(snapshot) : Promise.resolve();
	}
	async close() {
		this.context.shutdown.abort();
		await Promise.allSettled([...this.context.pending, this.worker.close()]);
	}
}
