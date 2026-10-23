import { randomUUID } from "node:crypto";
import { DomainError } from "../../../../shared/errors.js";
import { workReference } from "../../../../shared/external-reference.js";
import type { AcquisitionTarget } from "../../../anime/public.js";
import type { SourceSnapshot } from "../../sources/public.js";
import type {
	Candidate,
	SaveSubscriptionInput,
	Subscription,
	SubscriptionSearchInput,
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
import { SubscriptionDiscovery } from "./discovery.js";
import { PendingSubscriptions } from "./pending.js";
import { subscriptionPolicy as policy } from "./policy.js";
import { SubscriptionWorker } from "./worker.js";

function conflict(): never {
	throw new DomainError(
		"ACQUISITION_CONFLICT",
		"Subscription changed. Refresh and retry.",
	);
}
export class SubscriptionsApplication implements SubscriptionsApi {
	hasCapacity(): boolean {
		return (
			this.options.store.subscriptions().length < policy.maximumSubscriptions
		);
	}

	private timer: ReturnType<typeof setInterval> | undefined;
	private readonly pending: PendingSubscriptions;
	private readonly context: SubscriptionsContext;
	private readonly worker: SubscriptionWorker;
	private readonly discovery: SubscriptionDiscovery;
	constructor(private readonly options: SubscriptionsOptions) {
		this.context = new SubscriptionsContext(options);
		this.discovery = new SubscriptionDiscovery(this.context);
		this.pending = new PendingSubscriptions(this.context, this.discovery);
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
	search(input: SubscriptionSearchInput) {
		this.key(input.workKey);
		if (
			!Number.isSafeInteger(input.startEpisode) ||
			input.startEpisode < 1 ||
			input.startEpisode > 10000
		)
			throw new DomainError("INVALID_REQUEST", "Invalid starting episode.");
		return this.discovery.search(input);
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
			...(this.options.profileIssue
				? { issue: this.options.profileIssue }
				: {}),
		};
	}
	get(workKey: string, page = 1, diagnostics = true): SubscriptionView {
		this.key(workKey);
		if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
			throw new DomainError("INVALID_REQUEST", "Invalid candidate page.");
		const subscription = this.options.store.subscription(workKey);
		let feed = subscription
			? subscription.feedId
				? this.options.sources.snapshot(subscription.feedId)
				: null
			: null;
		let sourceError: string | null = null;
		if (subscription?.sourceInput) {
			try {
				const snapshot = this.options.sources.snapshot(
					subscription.sourceInput,
				);
				feed ??= snapshot;
			} catch {
				sourceError = "source_changed";
			}
		}
		const candidates = this.options.store
			.candidates(workKey)
			.sort(
				(a, b) =>
					(a.episode ?? Infinity) - (b.episode ?? Infinity) ||
					a.id.localeCompare(b.id),
			);
		return {
			subscription: subscription
				? {
						workKey: subscription.workKey,
						feedId: subscription.feedId,
						startEpisode: subscription.startEpisode,
						profileId: subscription.profileId ?? null,
						enabled: subscription.enabled,
						revision: subscription.revision,
						source:
							feed?.label ??
							(subscription.automatic
								? "Automatic source"
								: "Source unavailable"),
						sourceKind:
							subscription.sourceInput?.kind ??
							(subscription.automatic ? "automatic" : "feed"),
						checkedAt:
							feed?.checkedAt ?? subscription.discovery?.checkedAt ?? null,
						nextAttemptAt:
							feed?.nextAttemptAt ?? subscription.automatic?.retryAt ?? 0,
						error: sourceError ?? feed?.error ?? subscription.lastError ?? null,
					}
				: null,
			candidates: diagnostics
				? candidates.slice((page - 1) * policy.pageSize, page * policy.pageSize)
				: [],
			total: candidates.length,
			page,
			...(diagnostics && subscription?.discovery
				? { discovery: subscription.discovery }
				: {}),
		};
	}
	async save(input: SaveSubscriptionInput): Promise<SubscriptionView> {
		return this.persist(input);
	}
	saveAtomically(
		input: SaveSubscriptionInput,
		commit: (subscription: Subscription) => void,
	): SubscriptionView {
		return this.persist(input, commit);
	}
	private persist(
		input: SaveSubscriptionInput,
		commit?: (subscription: Subscription) => void,
	): SubscriptionView {
		this.key(input.workKey);
		if (
			!Number.isSafeInteger(input.startEpisode) ||
			input.startEpisode < 1 ||
			input.startEpisode > 10000
		)
			throw new DomainError("INVALID_REQUEST", "Invalid starting episode.");
		const current = this.options.store.subscription(input.workKey);
		if ((current?.revision ?? null) !== input.revision) conflict();
		if (!current && !this.hasCapacity())
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
		const automatic =
			input.source?.kind === "automatic" ||
			(!input.source && !current) ||
			(!input.source && !!current?.automatic && !current.feedId);
		const selectedProfile = (
			this.options.profiles ?? builtinAcquisitionProfiles
		).find(
			(profile) =>
				profile.id === (profileId ?? this.profiles().selectedProfileId),
		);
		const settings = this.options.sources.connector.settings();
		if (automatic && (!settings.ready || !settings.providers.length))
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Configure source sites in Settings first.",
			);
		const subscription: Subscription = {
			workKey: input.workKey,
			feedId: automatic ? null : (current?.feedId ?? null),
			sourceInput: automatic
				? null
				: input.source?.kind !== "automatic"
					? (input.source ?? current?.sourceInput ?? null)
					: null,
			...(current?.discovery && !automatic
				? { discovery: current.discovery }
				: {}),
			...(current?.createdBy ? { createdBy: current.createdBy } : {}),
			...(automatic && selectedProfile
				? {
						automatic: {
							sourceGeneration: settings.generation,
							profileFingerprint:
								acquisitionProfileFingerprint(selectedProfile),
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
			this.options.store.transaction(() => {
				if (!automatic) {
					const source = subscription.sourceInput ?? subscription.feedId;
					const snapshot = source
						? this.options.sources.snapshot(source)
						: null;
					if (!snapshot)
						throw new DomainError("INVALID_REQUEST", "Choose a source.");
					subscription.feedId = snapshot.id;
				}
				if (commit) commit(subscription);
				// Preserve existing selection clocks on a configuration edit; changed profiles are fenced until reevaluation.
				this.options.store.saveSubscription(
					subscription,
					current?.feedId === subscription.feedId
						? this.options.store.candidates(input.workKey)
						: [],
				);
				if (target && subscription.feedId)
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
		this.options.store.transaction(() => {
			const updated = { ...current, enabled, revision: randomUUID() };
			this.options.store.saveSubscription(
				updated,
				this.options.store.candidates(workKey),
			);
		});
		this.options.logger.info(
			{ event: "acquisition.subscription_toggled", enabled, workKey },
			"Subscription state changed.",
		);
		return this.get(workKey);
	}
	async remove(workKey: string, revision: string) {
		this.key(workKey);
		this.options.store.transaction(() => {
			if (this.options.store.subscription(workKey)?.revision !== revision)
				conflict();
			this.options.onRemoved?.(workKey);
			if (!this.options.store.remove(workKey, revision)) conflict();
		});
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
			if (!subscription.feedId && subscription.automatic) {
				this.options.logger.info(
					{ event: "acquisition.subscription_discovery_requested", workKey },
					"Manual check retries pending source discovery without its local delay.",
				);
				await this.pending.resolve(subscription, true);
				const resolved = this.options.store.subscription(workKey);
				if (resolved?.enabled && resolved.feedId) {
					const feed = this.options.sources.snapshot(
						resolved.sourceInput ?? resolved.feedId,
					);
					if (feed) await this.worker.pollSource(feed);
				}
				return this.get(workKey);
			}
			const source = subscription.sourceInput ?? subscription.feedId;
			const feed = source ? this.options.sources.snapshot(source) : null;
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
				(() => {
					const subscription = this.options.store.subscription(workKey);
					return subscription
						? {
								...subscription,
								enabled: subscription.enabled,
							}
						: null;
				})(),
			subscriptions: () =>
				this.options.store.subscriptions().map((subscription) => ({
					...subscription,
					enabled: subscription.enabled,
				})),
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
	start() {
		if (this.timer || this.context.signal.aborted) return;
		const tick = () => {
			void this.resolvePending().catch(() => {
				if (!this.context.signal.aborted)
					this.options.logger.warn(
						{ event: "acquisition.subscription_discovery_failed" },
						"Background discovery will retry.",
					);
			});
		};
		this.timer = setInterval(tick, 30000);
		this.timer.unref();
		tick();
	}
	resolvePending() {
		return this.context.tracked(() => this.pending.tick());
	}
	activeSourceIds(): string[] {
		return this.options.store
			.subscriptions()
			.filter((sub) => sub.enabled && sub.feedId !== null)
			.map((sub) => sub.feedId)
			.filter((id): id is string => id !== null);
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
		if (this.timer) clearInterval(this.timer);
		this.context.shutdown.abort();
		await Promise.allSettled([...this.context.pending, this.worker.close()]);
	}
}
