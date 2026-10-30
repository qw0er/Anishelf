import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { abortable } from "../../../../shared/abortable.js";
import { DomainError } from "../../../../shared/errors.js";
import { workReference } from "../../../../shared/external-reference.js";
import { isActiveViewing } from "../../../anime/public.js";
import type { SourcesApi } from "../../sources/public.js";
import type {
	SaveSubscriptionInput,
	Subscription,
	SubscriptionsApi,
} from "../../subscriptions/public.js";
import type {
	WatchingGrant,
	WatchingMember,
	WatchingPolicy,
	WatchingStore,
} from "../domain/model.js";
import type {
	WatchingApi,
	WatchingConfig,
	WatchingListPort,
	WatchingPreview,
	WatchingSnapshot,
	WatchingStatus,
} from "../public.js";

interface Options {
	store: WatchingStore;
	hasCapacity?(): boolean;
	renewManaged?(
		accountId: string,
		target: { destinationRevision: string; connectionGeneration: string },
		workKeys: readonly string[],
	): void;
	transaction(operation: () => void): void;
	tracking?: WatchingListPort;
	sources: SourcesApi;
	subscriptions: SubscriptionsApi;
	subscription(key: string): Subscription | null;
	admit(
		input: SaveSubscriptionInput,
		commit: (subscription: Subscription) => void,
	): void;
	target(): {
		revision: string;
		connectionGeneration: string;
		validated: boolean;
		path: string;
	} | null;
	profileFingerprint(id: string): string | null;
	logger: Logger;
	now?: () => number;
}
function conflict(): never {
	throw new DomainError(
		"ACQUISITION_CONFLICT",
		"Automation inputs changed. Preview and confirm again.",
	);
}
const emptySnapshot: WatchingSnapshot = {
	accountId: null,
	generation: "unavailable",
	revision: null,
	complete: false,
	fresh: false,
	refreshAllowed: false,
	retryAt: null,
	entries: [],
};
export class WatchingApplication implements WatchingApi {
	private timer: ReturnType<typeof setInterval> | undefined;
	private running: Promise<void> | undefined;
	private readonly shutdown = new AbortController();
	private readonly previews = new Map<
		string,
		{
			sessionId: string;
			grant: WatchingGrant;
			snapshot: string;
			scope: string;
			result: WatchingPreview;
		}
	>();
	constructor(private readonly options: Options) {}
	private startEpisode(
		progress: number,
		backlog: WatchingConfig["backlog"],
	): number | null {
		if (backlog === "beginning") return 1;
		return Number.isSafeInteger(progress) && progress >= 0 && progress < 10000
			? progress + 1
			: null;
	}
	private subscriptionReason(key: string): string | null {
		return this.options.subscription(key) ? "subscription_present" : null;
	}
	private now() {
		return this.options.now?.() ?? Date.now();
	}
	private policy(): WatchingPolicy {
		return (
			this.options.store.policy() ?? {
				revision: "unconfigured",
				enabled: false,
				grant: null,
				appliedSnapshot: null,
			}
		);
	}
	private snapshot() {
		return this.options.tracking?.snapshot() ?? emptySnapshot;
	}
	private member(accountId: string, key: string) {
		return this.options.store.member(accountId, key);
	}
	private put(row: WatchingMember) {
		const viewingStatus =
			this.snapshot().entries.find((entry) => entry.workKey === row.workKey)
				?.status ?? null;
		if (this.member(row.accountId, row.workKey)?.reason !== row.reason)
			this.options.logger.info(
				{
					event: "acquisition.watching_decision",
					viewingStatus,
					activeViewing: isActiveViewing(viewingStatus),
					workKey: row.workKey,
					accountId: row.accountId,
					reason: row.reason,
				},
				"Watching eligibility changed.",
			);
		this.options.store.saveMember({ ...row, revision: randomUUID() });
	}
	private make(accountId: string, key: string, title: string): WatchingMember {
		return {
			accountId,
			workKey: key,
			title,
			revision: randomUUID(),
			excluded: false,
			paused: false,
			subscriptionRevision: null,
			grantId: null,
			startEpisode: null,
			reason: "pending",
			retryAt: 0,
		};
	}
	private reason(policy = this.policy(), snapshot = this.snapshot()): string {
		if (!policy.enabled || !policy.grant) return "disabled";
		const grant = policy.grant;
		if (
			snapshot.accountId !== grant.accountId ||
			snapshot.generation !== grant.trackingGeneration
		)
			return "tracking_account_changed";
		if (
			snapshot.entries.filter((entry) => isActiveViewing(entry.status)).length >
			500
		)
			return "work_limit";
		if (!snapshot.complete || !snapshot.fresh || !snapshot.revision)
			return "tracking_unavailable";
		if (
			this.options.sources.connector.settings().generation !==
			grant.sourceRevision
		)
			return "source_changed";
		if (
			grant.profileId !==
				this.options.subscriptions.profiles().selectedProfileId ||
			this.options.profileFingerprint(grant.profileId) !==
				grant.profileFingerprint
		)
			return "profile_changed";
		const target = this.options.target();
		if (
			!target?.validated ||
			target.revision !== grant.destinationRevision ||
			target.connectionGeneration !== grant.downloaderGeneration
		)
			return "destination_changed";
		return "ready";
	}
	stopReason(subscription: Subscription): string | null {
		if (subscription.createdBy !== "watching") return null;
		const policy = this.policy();
		const reason = this.reason(policy);
		if (reason !== "ready") return reason;
		if (
			!subscription.watchingAccountId ||
			subscription.watchingAccountId !== policy.grant?.accountId
		)
			return "authorization_required";
		if (
			subscription.sourceInput?.kind === "search" &&
			subscription.sourceInput.connectionRevision !==
				this.options.sources.connector.settings().generation
		)
			return "source_reselection_required";
		const row = this.member(
			subscription.watchingAccountId,
			subscription.workKey,
		);
		if (row?.excluded || row?.paused) return "excluded";
		if (
			!this.snapshot().entries.some(
				(entry) =>
					entry.workKey === subscription.workKey &&
					isActiveViewing(entry.status),
			)
		)
			return "not_watching";
		return null;
	}
	manualRemove(key: string) {
		const snapshot = this.snapshot();
		const accounts = new Set(
			this.options.store
				.members()
				.filter((row) => row.workKey === key)
				.map((row) => row.accountId),
		);
		const accountId = snapshot.accountId ?? this.policy().grant?.accountId;
		if (accountId) accounts.add(accountId);
		for (const accountId of accounts) {
			const row =
				this.member(accountId, key) ??
				this.make(
					accountId,
					key,
					snapshot.entries.find((entry) => entry.workKey === key)?.title ?? key,
				);
			this.put({
				...row,
				excluded: true,
				paused: false,
				subscriptionRevision: null,
				grantId: null,
				reason: "excluded",
			});
		}
	}
	status(): WatchingStatus {
		const snapshot = this.snapshot(),
			policy = this.policy();
		const rows = this.options.store
			.members()
			.filter((row) => row.accountId === snapshot.accountId);
		const keys = [
			...new Set([
				...snapshot.entries
					.filter((entry) => isActiveViewing(entry.status))
					.map((entry) => entry.workKey),
				...rows.map((row) => row.workKey),
			]),
		].sort();
		return {
			revision: policy.revision,
			enabled: policy.enabled,
			reason: this.reason(policy, snapshot),
			accountId: snapshot.accountId,
			trackingGeneration: snapshot.generation,
			config: policy.grant
				? { backlog: policy.grant.backlog, profileId: policy.grant.profileId }
				: null,
			works: keys.map((workKey) => {
				const row = rows.find((row) => row.workKey === workKey);
				const subscription = this.options.subscription(workKey);
				const entry = snapshot.entries.find(
					(entry) => entry.workKey === workKey,
				);
				return {
					workKey,
					title: entry?.title ?? row?.title ?? workKey,
					revision: row?.revision ?? null,
					managed: subscription?.createdBy === "watching",
					excluded: row?.excluded ?? false,
					paused:
						subscription?.createdBy === "watching" &&
						Boolean(this.stopReason(subscription)),
					startEpisode: subscription?.startEpisode ?? row?.startEpisode ?? null,
					reason:
						(subscription?.createdBy === "watching"
							? this.managedReason(subscription)
							: this.subscriptionReason(workKey)) ??
						(row?.excluded ? "excluded" : (row?.reason ?? "pending")),
				};
			}),
		};
	}
	private managedReason(subscription: Subscription) {
		if (subscription.completion && !subscription.completion.resumed)
			return "completed";
		return this.stopReason(subscription) ?? "managed";
	}
	private scope(snapshot: WatchingSnapshot) {
		return createHash("sha256")
			.update(
				JSON.stringify(
					snapshot.entries
						.filter((entry) => isActiveViewing(entry.status))
						.map((entry) => [
							entry.workKey,
							this.options.subscription(entry.workKey)?.revision,
							this.member(snapshot.accountId ?? "", entry.workKey)?.revision,
						]),
				),
			)
			.digest("hex");
	}

	async preview(
		sessionId: string,
		revision: string,
		config: WatchingConfig,
	): Promise<WatchingPreview> {
		if (this.shutdown.signal.aborted || revision !== this.policy().revision)
			conflict();
		if (
			config.profileId !==
			this.options.subscriptions.profiles().selectedProfileId
		)
			conflict();
		const snapshot = this.options.tracking
			? await abortable(this.options.tracking.refresh(), this.shutdown.signal)
			: undefined;
		if (
			!snapshot?.accountId ||
			!snapshot.complete ||
			!snapshot.fresh ||
			!snapshot.revision
		)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"A fresh complete tracking list is required.",
			);
		const profileFingerprint = this.options.profileFingerprint(
				config.profileId,
			),
			target = this.options.target(),
			sources = this.options.sources.connector.settings();
		if (!profileFingerprint || !target?.validated || !sources.ready)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Validate a download destination and configure a release profile and source sites first.",
			);
		if (revision !== this.policy().revision) conflict();
		const entries = snapshot.entries.filter((entry) =>
			isActiveViewing(entry.status),
		);
		if (entries.length > 500)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Automation currently supports at most 500 Watching works.",
			);
		const result: WatchingPreview = {
			id: randomUUID(),
			expiresAt: this.now() + 300000,
			revision,
			config,
			destination: target.path,
			providers: [...sources.providers],
			works: entries.map((entry) => {
				const row = this.member(snapshot.accountId ?? "", entry.workKey);
				return {
					workKey: entry.workKey,
					title: entry.title,
					startEpisode:
						row?.startEpisode ??
						this.startEpisode(entry.progress, config.backlog),
					reason:
						this.subscriptionReason(entry.workKey) ??
						(row?.excluded
							? "excluded"
							: row?.paused
								? "manually_paused"
								: this.startEpisode(entry.progress, config.backlog) === null &&
										row?.startEpisode == null
									? "invalid_progress"
									: this.options.subscription(entry.workKey)?.sourceInput
												?.kind === "search"
										? "will_renew_source"
										: "will_manage"),
				};
			}),
		};
		// One candidate per session, bounded globally; activation candidates never persist.
		for (const [id, value] of this.previews)
			if (value.sessionId === sessionId || value.result.expiresAt <= this.now())
				this.previews.delete(id);
		if (this.previews.size >= 20)
			this.previews.delete(this.previews.keys().next().value ?? "");
		this.previews.set(result.id, {
			sessionId,
			snapshot: snapshot.revision,
			scope: this.scope(snapshot),
			result,
			grant: {
				id: randomUUID(),
				...config,
				accountId: snapshot.accountId,
				trackingGeneration: snapshot.generation,
				sourceRevision: sources.generation,
				profileFingerprint,
				destinationRevision: target.revision,
				downloaderGeneration: target.connectionGeneration,
			},
		});
		this.options.logger.info(
			{
				event: "acquisition.watching_previewed",
				works: entries.length,
				rewatchingWorks: entries.filter(
					(entry) => entry.status === "rewatching",
				).length,
				profileId: config.profileId,
				backlog: config.backlog,
			},
			"Watching activation scope prepared without authorizing downloads.",
		);
		return structuredClone(result);
	}
	confirm(sessionId: string, id: string): WatchingStatus {
		const candidate = this.previews.get(id);
		if (
			!candidate ||
			candidate.sessionId !== sessionId ||
			candidate.result.expiresAt <= this.now() ||
			candidate.result.revision !== this.policy().revision
		)
			conflict();
		const policy: WatchingPolicy = {
			revision: randomUUID(),
			enabled: true,
			grant: candidate.grant,
			appliedSnapshot: null,
		};
		if (
			this.shutdown.signal.aborted ||
			this.reason(policy) !== "ready" ||
			this.snapshot().revision !== candidate.snapshot ||
			this.scope(this.snapshot()) !== candidate.scope
		)
			conflict();
		this.options.transaction(() => {
			if (this.policy().revision !== candidate.result.revision) conflict();
			this.options.store.savePolicy(policy);
			for (const work of candidate.result.works) {
				const subscription = this.options.subscription(work.workKey);
				if (
					subscription?.createdBy === "watching" &&
					!subscription.enabled &&
					(!subscription.watchingAccountId ||
						subscription.watchingAccountId === candidate.grant.accountId)
				) {
					const row =
						this.member(candidate.grant.accountId, work.workKey) ??
						this.make(candidate.grant.accountId, work.workKey, work.title);
					this.put({
						...row,
						excluded: true,
						paused: false,
						reason: "excluded",
					});
				}
			}
			this.options.renewManaged?.(
				candidate.grant.accountId,
				{
					destinationRevision: candidate.grant.destinationRevision,
					connectionGeneration: candidate.grant.downloaderGeneration,
				},
				candidate.result.works.map((work) => work.workKey),
			);
		});
		this.previews.delete(id);
		this.options.logger.info(
			{ event: "acquisition.watching_enabled", grantId: policy.grant?.id },
			"Watching automation explicitly enabled.",
		);
		return this.status();
	}
	disable(revision: string): WatchingStatus {
		if (revision !== this.policy().revision) conflict();
		this.options.store.savePolicy({
			...this.policy(),
			enabled: false,
			revision: randomUUID(),
		});
		this.previews.clear();
		this.options.logger.info(
			{ event: "acquisition.watching_disabled" },
			"New managed acquisitions stopped; existing transfers continue.",
		);
		return this.status();
	}
	override(input: Parameters<WatchingApi["override"]>[0]): WatchingStatus {
		try {
			workReference(input.workKey);
		} catch {
			throw new DomainError("INVALID_REQUEST", "Invalid anime reference.");
		}
		const snapshot = this.snapshot();
		if (
			snapshot.accountId !== input.accountId ||
			snapshot.generation !== input.trackingGeneration
		)
			conflict();
		const row = this.member(input.accountId, input.workKey),
			entry = snapshot.entries.find((entry) => entry.workKey === input.workKey);
		if ((row?.revision ?? null) !== input.revision) conflict();
		if (!entry && !row)
			throw new DomainError(
				"INVALID_REQUEST",
				"Work is not in the tracking snapshot.",
			);
		this.put({
			...(row ??
				this.make(
					input.accountId,
					input.workKey,
					entry?.title ?? input.workKey,
				)),
			excluded: input.excluded,
			paused: false,
			retryAt: 0,
		});
		this.options.logger.info(
			{
				event: "acquisition.watching_override_saved",
				workKey: input.workKey,
				excluded: input.excluded,
				paused: false,
			},
			"Manual Watching override saved.",
		);
		return this.status();
	}
	private guard(policy: WatchingPolicy, snapshot: WatchingSnapshot) {
		if (
			this.shutdown.signal.aborted ||
			this.policy().revision !== policy.revision ||
			this.reason(policy) !== "ready" ||
			this.snapshot().revision !== snapshot.revision
		)
			conflict();
	}
	private async run() {
		const policy = this.policy();
		if (!policy.enabled || !policy.grant || !this.options.tracking) return;
		let snapshot = this.snapshot();
		if (
			!snapshot.fresh &&
			snapshot.refreshAllowed &&
			(snapshot.retryAt === null || snapshot.retryAt <= this.now())
		)
			snapshot = await abortable(
				this.options.tracking.refresh(),
				this.shutdown.signal,
			);
		if (this.reason(policy, snapshot) !== "ready") return;
		const grant = policy.grant;
		for (const row of this.options.store.members()) {
			if (row.accountId !== grant.accountId) continue;
			const subscription = this.options.subscription(row.workKey);
			if (
				subscription?.createdBy !== "watching" ||
				subscription.watchingAccountId !== grant.accountId
			)
				continue;
			const reason = this.managedReason(subscription);
			if (row.reason !== reason)
				this.put({ ...row, reason, startEpisode: subscription.startEpisode });
		}
		let attempted = 0,
			deferred = false;
		for (const entry of snapshot.entries.filter((entry) =>
			isActiveViewing(entry.status),
		)) {
			this.guard(policy, snapshot);
			const existing = this.options.subscription(entry.workKey);
			const row =
				this.member(grant.accountId, entry.workKey) ??
				this.make(grant.accountId, entry.workKey, entry.title);
			if (existing) {
				if (
					existing.createdBy === "watching" &&
					existing.watchingAccountId === grant.accountId
				) {
					const reason = this.managedReason(existing);
					if (row.reason !== reason)
						this.put({ ...row, reason, startEpisode: existing.startEpisode });
				}
				continue;
			}
			if (row.excluded) continue;
			if (this.options.hasCapacity?.() === false) {
				if (row.reason !== "subscription_limit")
					this.put({ ...row, reason: "subscription_limit" });
				continue;
			}
			const startEpisode = this.startEpisode(entry.progress, grant.backlog);
			if (startEpisode === null) {
				if (row.reason !== "invalid_progress")
					this.put({ ...row, reason: "invalid_progress" });
				continue;
			}
			if (attempted++ >= 5) {
				deferred = true;
				continue;
			}
			try {
				this.options.admit(
					{
						workKey: entry.workKey,
						revision: null,
						source: { kind: "automatic" },
						startEpisode,
						profileId: grant.profileId,
						target: {
							destinationRevision: grant.destinationRevision,
							connectionGeneration: grant.downloaderGeneration,
						},
					},
					(saved) => {
						this.guard(policy, snapshot);
						const current = this.member(grant.accountId, entry.workKey);
						if (current && current.revision !== row.revision) conflict();
						saved.createdBy = "watching";
						saved.watchingAccountId = grant.accountId;
						this.put({
							...row,
							startEpisode,
							subscriptionRevision: null,
							grantId: null,
							reason: "created",
							retryAt: 0,
						});
					},
				);
				this.options.logger.info(
					{
						event: "acquisition.watching_subscription_created",
						viewingStatus: entry.status,
						activeViewing: isActiveViewing(entry.status),
						workKey: entry.workKey,
						grantId: grant.id,
					},
					"Watching created a group-managed subscription; discovery will run in the background.",
				);
			} catch (error) {
				this.options.logger.warn(
					{
						event: "acquisition.watching_creation_failed",
						workKey: entry.workKey,
						code: error instanceof DomainError ? error.code : "unavailable",
					},
					"Watching subscription creation deferred.",
				);
			}
		}
		this.guard(policy, snapshot);
		if (!deferred)
			this.options.store.savePolicy({
				...policy,
				appliedSnapshot: snapshot.revision,
			});
	}
	tick(): Promise<void> {
		if (this.running || this.shutdown.signal.aborted)
			return this.running ?? Promise.resolve();
		const task = this.run().catch(() => {
			if (!this.shutdown.signal.aborted)
				this.options.logger.warn(
					{ event: "acquisition.watching_reconciliation_failed" },
					"Watching reconciliation will retry without changing accepted scopes.",
				);
		});
		this.running = task;
		void task.finally(() => {
			this.running = undefined;
		});
		return task;
	}
	start() {
		if (this.timer || this.shutdown.signal.aborted) return;
		this.timer = setInterval(() => void this.tick(), 30000);
		this.timer.unref();
		void this.tick();
	}
	stop() {
		this.shutdown.abort();
		if (this.timer) clearInterval(this.timer);
		this.previews.clear();
	}
	async close() {
		this.stop();
		await this.running;
	}
}
