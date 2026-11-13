import { randomUUID } from "node:crypto";
import { DomainError } from "../../../../shared/errors.js";
import { workReference } from "../../../../shared/external-reference.js";
import type { AcquisitionTarget } from "../../../anime/public.js";
import type { SourceSnapshot } from "../../sources/public.js";
import { coveredEpisodeCount } from "../domain/completion.js";
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

import { SubscriptionWorker } from "./worker.js";

const maximumSubscriptions = 64;
const pageSize = 20;

function conflict(): never {
	throw new DomainError(
		"ACQUISITION_CONFLICT",
		"Subscription changed. Refresh and retry.",
	);
}
export class SubscriptionsApplication implements SubscriptionsApi {
	async list() {
		return Promise.all(
			this.options.store.subscriptions().map(async (sub) => {
				let title = sub.workKey;
				try {
					title =
						(await this.options.anime.target(sub.workKey, this.context.signal))
							.searchTitles[0] ?? title;
				} catch {
					this.options.logger.debug(
						{
							event: "acquisition.subscription_summary_unavailable",
							workKey: sub.workKey,
						},
						"Subscription title unavailable",
					);
				}
				return { title, view: this.get(sub.workKey, 1, false) };
			}),
		);
	}
	hasCapacity(): boolean {
		return this.options.store.subscriptions().length < maximumSubscriptions;
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
		const candidates = this.selection()
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
						management:
							subscription.createdBy === "watching" ? "watching" : "manual",
						runState: this.context.stopReason(subscription) ?? "active",
						revision: subscription.revision,
						...(subscription.schedule
							? {
									schedule: {
										...subscription.schedule,
										metadataFresh:
											subscription.schedule.metadataFresh &&
											subscription.schedule.metadataCheckAt >
												this.context.now(),
										nextCheckAt:
											subscription.schedule.nextCheckAt === null
												? null
												: Math.max(
														this.context.scheduling.resourceDueAt(subscription),
														feed?.error ? feed.nextAttemptAt : 0,
													),
									},
								}
							: {}),
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
				? candidates.slice((page - 1) * pageSize, page * pageSize)
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
			// A save from the work editor explicitly takes manual ownership.
			...(current?.completion && current.startEpisode === input.startEpisode
				? { completion: current.completion }
				: {}),
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
		return this.get(input.workKey);
	}
	async setEnabled(workKey: string, revision: string, enabled: boolean) {
		this.key(workKey);
		const current = this.options.store.subscription(workKey);
		if (!current || current.revision !== revision) conflict();
		if (
			current.createdBy === "watching" &&
			!(enabled && current.completion && !current.completion.resumed)
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"Manage automatic subscriptions in Watching settings or convert to manual first.",
			);
		this.options.store.transaction(() => {
			const updated = {
				...current,
				enabled,
				...(enabled && current.completion
					? { completion: { ...current.completion, resumed: true } }
					: {}),
				revision: randomUUID(),
			};
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
			const current = this.options.store.subscription(workKey);
			if (current?.revision !== revision) conflict();
			if (current.createdBy === "watching")
				throw new DomainError(
					"INVALID_REQUEST",
					"Exclude automatic subscriptions in Watching settings.",
				);
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
			if (
				!subscription ||
				!this.context.runnable(subscription) ||
				subscription.revision !== revision
			)
				conflict();
			if (!subscription.feedId && subscription.automatic) {
				this.options.logger.info(
					{ event: "acquisition.subscription_discovery_requested", workKey },
					"Manual check retries pending source discovery without its local delay.",
				);
				await this.pending.resolve(subscription, true);
				const resolved = this.options.store.subscription(workKey);
				if (resolved && this.context.runnable(resolved) && resolved.feedId) {
					const feed = this.options.sources.snapshot(
						resolved.sourceInput ?? resolved.feedId,
					);
					if (feed) await this.worker.pollSource(feed, true);
				}
				return this.get(workKey);
			}
			const source = subscription.sourceInput ?? subscription.feedId;
			const feed = source ? this.options.sources.snapshot(source) : null;
			if (!feed) conflict();
			await this.worker.pollSource(feed, true);
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
			subscription.createdBy === "watching"
				? this.profiles().selectedProfileId
				: (subscription.profileId ?? this.profiles().selectedProfileId);
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
			if (
				candidate.selection &&
				!this.options
					.lockedCandidates?.(subscription.workKey)
					.includes(candidate.id)
			)
				candidate.selection.policyRevision =
					this.context.profileScope(subscription);
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
								// Existing reservations retain their choice; all ownership and scope checks still apply.
								enabled: this.context.stopReason(subscription, false) === null,
							}
						: null;
				})(),
			subscriptions: () =>
				this.options.store.subscriptions().map((subscription) => ({
					...subscription,
					enabled: this.context.runnable(subscription),
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
						candidate.selection?.profileId === profile.id &&
						candidate.selection?.fingerprint ===
							acquisitionProfileFingerprint(profile) &&
						(subscription?.createdBy !== "watching" ||
							candidate.selection.policyRevision ===
								this.context.profileScope(subscription ?? {})))
						? candidate
						: {
								...candidate,
								status: "skipped" as const,
								reasons: [profile ? "profile_changed" : "profile_unavailable"],
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
	defaultProfileChanged() {
		for (const sub of this.options.store.subscriptions()) {
			if (sub.createdBy !== "watching") continue;
			if (sub.automatic)
				this.options.store.saveSubscription(
					{ ...sub, automatic: { ...sub.automatic, retryAt: 0 } },
					this.options.store.candidates(sub.workKey),
				);
			this.options.logger.info(
				{
					event: "acquisition.subscription_profile_invalidated",
					workKey: sub.workKey,
					profileId: this.profiles().selectedProfileId,
					reason: "global_default_changed",
					policyRevision: this.context.profileScope(sub),
				},
				"Unreserved choices will be re-evaluated against the global default.",
			);
		}
	}
	private async reassessDefaults() {
		for (const sub of this.options.store.subscriptions()) {
			if (
				!sub.feedId ||
				sub.createdBy !== "watching" ||
				!this.context.runnable(sub)
			)
				continue;
			const scope = this.context.profileScope(sub);
			const candidates = this.options.store.candidates(sub.workKey);
			const locked = this.options.lockedCandidates?.(sub.workKey) ?? [];
			if (
				candidates.length &&
				candidates.every(
					(c) => locked.includes(c.id) || c.selection?.policyRevision === scope,
				)
			)
				continue;
			const feed = this.options.sources.snapshot(sub.sourceInput ?? sub.feedId);
			if (!feed) continue;
			try {
				const target = await this.options.anime.target(
					sub.workKey,
					this.context.signal,
				);
				const updated = await this.evaluateCandidates(sub, feed, target);
				const current = this.options.store.subscription(sub.workKey);
				if (
					!current ||
					current.revision !== sub.revision ||
					!this.context.runnable(current) ||
					this.context.profileScope(current) !== scope ||
					this.options.sources.snapshot(sub.sourceInput ?? sub.feedId)
						?.revision !== feed.revision ||
					JSON.stringify(locked) !==
						JSON.stringify(this.options.lockedCandidates?.(sub.workKey) ?? [])
				)
					continue;
				this.options.store.updateCandidates(sub, updated, null);
			} catch {
				this.options.logger.debug(
					{
						event: "acquisition.profile_reassessment_deferred",
						workKey: sub.workKey,
					},
					"Profile reassessment will retry.",
				);
			}
		}
	}
	resolvePending() {
		return this.context.tracked(async () => {
			await this.checkCompletion();
			await this.pending.tick();
			await this.reassessDefaults();
		});
	}
	activeSourceIds(): string[] {
		return this.options.store
			.subscriptions()
			.filter((sub) => this.context.runnable(sub) && sub.feedId !== null)
			.map((sub) => sub.feedId)
			.filter((id): id is string => id !== null);
	}
	sourceNextCheckAt(feed: SourceSnapshot) {
		const subscribers = this.options.store
			.subscriptions()
			.filter((sub) => sub.feedId === feed.id && this.context.runnable(sub));
		return Math.min(
			...subscribers.map((sub) => this.context.scheduling.dueAt(sub)),
		);
	}
	refreshSource(id: string) {
		const subscription = this.options.store
			.subscriptions()
			.find((item) => this.context.runnable(item) && item.feedId === id);
		const snapshot = subscription
			? this.options.sources.snapshot(subscription.sourceInput ?? id)
			: null;
		return snapshot ? this.worker.pollSource(snapshot) : Promise.resolve();
	}

	private completionCheck: Promise<void> | undefined;
	checkCompletion(): Promise<void> {
		if (this.completionCheck) return this.completionCheck;
		const task = this.updateCompletion().finally(() => {
			this.completionCheck = undefined;
		});
		this.completionCheck = task;
		return task;
	}
	private async updateCompletion() {
		for (const subscription of this.options.store.subscriptions()) {
			if (!subscription.enabled) continue;
			try {
				const target = await this.context.scheduling.read(subscription);
				if (!target) continue;
				this.context.open();
				const current = this.options.store.subscription(subscription.workKey);
				if (!current || current.revision !== subscription.revision) continue;
				const total = target.work.episodeCount;
				const previous = current.completion;
				const covered = coveredEpisodeCount(current, target);
				const expanded =
					previous && total !== null && total > previous.episodeCount;
				if (previous && !expanded) continue;
				if (covered === null && !expanded) continue;
				const updated = {
					...(this.options.store.subscription(current.workKey) ?? current),
					completion:
						covered === null
							? null
							: { episodeCount: covered, completedAt: this.context.now() },
					revision: randomUUID(),
				};
				this.options.store.saveSubscription(
					updated,
					this.options.store.candidates(current.workKey),
				);
				this.options.logger.info(
					{
						event:
							covered === null
								? "acquisition.subscription_reopened"
								: "acquisition.subscription_completed",
						workKey: current.workKey,
						episodeCount: total,
					},
					"Subscription coverage state changed.",
				);
			} catch {
				if (this.context.signal.aborted) return;
				this.context.scheduling.update(subscription, null);
				this.options.logger.debug(
					{
						event: "acquisition.subscription_coverage_unavailable",
						workKey: subscription.workKey,
					},
					"Coverage check will retry without changing subscription state.",
				);
			}
		}
	}

	/** Explicit confirmation renews managed permissions without changing saved release settings. */
	renewManaged(
		accountId: string,
		target: NonNullable<SaveSubscriptionInput["target"]>,
		workKeys: readonly string[],
	) {
		for (const sub of this.options.store.subscriptions()) {
			if (
				sub.createdBy !== "watching" ||
				(sub.watchingAccountId !== accountId &&
					(sub.watchingAccountId != null || !workKeys.includes(sub.workKey)))
			)
				continue;
			const profile = (
				this.options.profiles ?? builtinAcquisitionProfiles
			).find(
				(profile) =>
					profile.id === (sub.profileId ?? this.profiles().selectedProfileId),
			);
			if (!profile) continue;
			const settings = this.options.sources.connector.settings();
			const sourceInput =
				sub.sourceInput?.kind === "search" &&
				settings.providers.includes(sub.sourceInput.providerId)
					? { ...sub.sourceInput, connectionRevision: settings.generation }
					: sub.sourceInput;
			const feedId =
				sourceInput &&
				!(
					sourceInput.kind === "search" &&
					sourceInput.connectionRevision !== settings.generation
				)
					? (this.options.sources.snapshot(sourceInput)?.id ?? sub.feedId)
					: sub.feedId;
			const updated = {
				...sub,
				sourceInput: sourceInput ?? null,
				feedId,
				watchingAccountId: accountId,
				enabled: true,
				revision: randomUUID(),
				...(sub.automatic
					? {
							automatic: {
								...sub.automatic,
								sourceGeneration:
									this.options.sources.connector.settings().generation,
								target,
								retryAt: 0,
							},
						}
					: {}),
			};
			this.options.store.saveSubscription(
				updated,
				sub.feedId === feedId ? this.options.store.candidates(sub.workKey) : [],
			);
			if (feedId)
				this.options.store.authorize({
					workKey: sub.workKey,
					feedId,
					startEpisode: sub.startEpisode,
					...target,
				});
		}
	}

	async close() {
		if (this.timer) clearInterval(this.timer);
		this.context.shutdown.abort();
		await Promise.allSettled([
			...this.context.pending,
			this.worker.close(),
			this.context.scheduling.close(),
		]);
	}
}
