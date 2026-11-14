import { randomUUID } from "node:crypto";
import { workReference } from "@anishelf/contracts/references";
import { DomainError } from "../../../../shared/errors.js";
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
import type { SubscriptionsApi, SubscriptionViewOptions } from "../public.js";
import { SubscriptionCompletion } from "./completion.js";
import { SubscriptionsContext, type SubscriptionsOptions } from "./context.js";
import { SubscriptionDiscovery } from "./discovery.js";
import { PendingSubscriptions } from "./pending.js";
import { maximumSubscriptions, saveSubscription } from "./save.js";
import { projectSubscriptionView } from "./view.js";
import { SubscriptionWorker } from "./worker.js";

function conflict(): never {
	throw new DomainError(
		"ACQUISITION_CONFLICT",
		"Subscription changed. Refresh and retry.",
	);
}
export class SubscriptionsApplication implements SubscriptionsApi {
	private readonly completion: SubscriptionCompletion;
	private timer: ReturnType<typeof setInterval> | undefined;
	private readonly pending: PendingSubscriptions;
	private readonly context: SubscriptionsContext;
	private readonly worker: SubscriptionWorker;
	private readonly discovery: SubscriptionDiscovery;
	constructor(private readonly options: SubscriptionsOptions) {
		this.context = new SubscriptionsContext(options);
		this.completion = new SubscriptionCompletion({
			store: options.store,
			scheduling: this.context.scheduling,
			signal: this.context.signal,
			assertOpen: () => this.context.open(),
			now: () => this.context.now(),
			logger: options.logger,
		});
		this.discovery = new SubscriptionDiscovery(this.context);
		this.pending = new PendingSubscriptions(this.context, this.discovery);
		this.worker = new SubscriptionWorker(
			this.context,
			(subscription, feed, target) =>
				this.evaluateCandidates(subscription, feed, target),
		);
	}
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
				return {
					title,
					view: this.get(sub.workKey, { includeDiagnostics: false }),
				};
			}),
		);
	}
	hasCapacity(): boolean {
		return this.options.store.subscriptions().length < maximumSubscriptions;
	}

	search(input: SubscriptionSearchInput) {
		this.assertOpenWork(input.workKey);
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
	get(
		workKey: string,
		{ page = 1, includeDiagnostics = true }: SubscriptionViewOptions = {},
	): SubscriptionView {
		this.assertOpenWork(workKey);
		if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
			throw new DomainError("INVALID_REQUEST", "Invalid candidate page.");

		const subscription = this.options.store.subscription(workKey);
		const { feed, sourceChanged } = this.readSubscriptionSource(subscription);
		const candidates = this.selection().candidates(workKey);
		const runState = subscription
			? (this.context.stopReason(subscription) ?? "active")
			: "active";

		return projectSubscriptionView({
			subscription,
			feed,
			sourceChanged,
			runState,
			schedule: subscription
				? this.readViewSchedule(subscription, feed)
				: undefined,
			candidates,
			page,
			includeDiagnostics,
		});
	}
	async save(input: SaveSubscriptionInput): Promise<SubscriptionView> {
		return this.saveAtomically(input);
	}
	saveAtomically(
		input: SaveSubscriptionInput,
		commit?: (subscription: Subscription) => void,
	): SubscriptionView {
		this.assertOpenWork(input.workKey);
		saveSubscription(this.options, input, commit);
		return this.get(input.workKey);
	}
	async setEnabled(workKey: string, revision: string, enabled: boolean) {
		this.assertOpenWork(workKey);
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
		this.assertOpenWork(workKey);
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
			this.assertOpenWork(workKey);
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

	checkCompletion(): Promise<void> {
		return this.completion.check();
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

	private assertOpenWork(workKey: string): void {
		this.context.open();
		try {
			workReference(workKey);
		} catch {
			throw new DomainError("INVALID_REQUEST", "Invalid anime reference.");
		}
	}

	private readSubscriptionSource(subscription: Subscription | null): {
		feed: SourceSnapshot | null;
		sourceChanged: boolean;
	} {
		const feed = subscription?.feedId
			? this.options.sources.snapshot(subscription.feedId)
			: null;
		if (!subscription?.sourceInput) return { feed, sourceChanged: false };

		try {
			const configuredSource = this.options.sources.snapshot(
				subscription.sourceInput,
			);
			return { feed: feed ?? configuredSource, sourceChanged: false };
		} catch {
			this.options.logger.debug(
				{
					event: "acquisition.subscription_view_source_changed",
					workKey: subscription.workKey,
				},
				"Subscription source could not be resolved",
			);
			return { feed, sourceChanged: true };
		}
	}

	private readViewSchedule(
		subscription: Subscription,
		feed: SourceSnapshot | null,
	) {
		const schedule = subscription.schedule;
		if (!schedule) return undefined;

		const metadataFresh =
			schedule.metadataFresh && schedule.metadataCheckAt > this.context.now();
		let nextCheckAt = schedule.nextCheckAt;
		if (nextCheckAt !== null) {
			nextCheckAt = Math.max(
				this.context.scheduling.resourceDueAt(subscription),
				feed?.error ? feed.nextAttemptAt : 0,
			);
		}
		return { ...schedule, metadataFresh, nextCheckAt };
	}
}
