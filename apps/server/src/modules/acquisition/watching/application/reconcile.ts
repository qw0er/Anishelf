import type { Logger } from "pino";
import { abortable } from "../../../../shared/abortable.js";
import { DomainError } from "../../../../shared/errors.js";
import { isActiveViewing } from "../../../anime/public.js";
import type {
	SaveSubscriptionInput,
	Subscription,
} from "../../subscriptions/public.js";
import type {
	WatchingMember,
	WatchingPolicy,
	WatchingStore,
} from "../domain/model.js";
import type { WatchingListPort, WatchingSnapshot } from "../public.js";
import { watchingStartEpisode } from "./preview.js";

export function watchingConflict(): never {
	throw new DomainError(
		"ACQUISITION_CONFLICT",
		"Automation inputs changed. Preview and confirm again.",
	);
}

export class WatchingReconciliation {
	constructor(
		private readonly options: {
			store: Pick<WatchingStore, "members" | "savePolicy">;
			tracking?: WatchingListPort;
			signal: AbortSignal;
			logger: Logger;
			policy(): WatchingPolicy;
			snapshot(): WatchingSnapshot;
			reason(policy: WatchingPolicy, snapshot?: WatchingSnapshot): string;
			now(): number;
			subscription(key: string): Subscription | null;
			managedReason(subscription: Subscription): string;
			put(row: WatchingMember): void;
			member(accountId: string, key: string): WatchingMember | undefined;
			make(accountId: string, key: string, title: string): WatchingMember;
			hasCapacity?(): boolean;
			admit(
				input: SaveSubscriptionInput,
				commit: (subscription: Subscription) => void,
			): void;
		},
	) {}
	async reconcile(): Promise<void> {
		const policy = this.options.policy();
		if (!policy.enabled || !policy.grant || !this.options.tracking) return;
		let snapshot = this.options.snapshot();
		if (
			!snapshot.fresh &&
			snapshot.refreshAllowed &&
			(snapshot.retryAt === null || snapshot.retryAt <= this.options.now())
		)
			snapshot = await abortable(
				this.options.tracking.refresh(),
				this.options.signal,
			);
		if (this.options.reason(policy, snapshot) !== "ready") return;
		const grant = policy.grant;
		for (const row of this.options.store.members()) {
			if (row.accountId !== grant.accountId) continue;
			const subscription = this.options.subscription(row.workKey);
			if (
				subscription?.createdBy !== "watching" ||
				subscription.watchingAccountId !== grant.accountId
			)
				continue;
			const reason = this.options.managedReason(subscription);
			if (row.reason !== reason)
				this.options.put({
					...row,
					reason,
					startEpisode: subscription.startEpisode,
				});
		}
		let attempted = 0,
			deferred = false;
		for (const entry of snapshot.entries.filter((entry) =>
			isActiveViewing(entry.status),
		)) {
			this.guard(policy, snapshot);
			const existing = this.options.subscription(entry.workKey);
			const row =
				this.options.member(grant.accountId, entry.workKey) ??
				this.options.make(grant.accountId, entry.workKey, entry.title);
			if (existing) {
				if (
					existing.createdBy === "watching" &&
					existing.watchingAccountId === grant.accountId
				) {
					const reason = this.options.managedReason(existing);
					if (row.reason !== reason)
						this.options.put({
							...row,
							reason,
							startEpisode: existing.startEpisode,
						});
				}
				continue;
			}
			if (row.excluded) continue;
			if (this.options.hasCapacity?.() === false) {
				if (row.reason !== "subscription_limit")
					this.options.put({ ...row, reason: "subscription_limit" });
				continue;
			}
			const startEpisode = watchingStartEpisode(entry.progress, grant.backlog);
			if (startEpisode === null) {
				if (row.reason !== "invalid_progress")
					this.options.put({ ...row, reason: "invalid_progress" });
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
						profileId: null,
						target: {
							destinationRevision: grant.destinationRevision,
							connectionGeneration: grant.downloaderGeneration,
						},
					},
					(saved) => {
						this.guard(policy, snapshot);
						const current = this.options.member(grant.accountId, entry.workKey);
						if (current && current.revision !== row.revision)
							watchingConflict();
						saved.createdBy = "watching";
						saved.profileId = null;
						if (saved.automatic) delete saved.automatic.profileFingerprint;
						saved.watchingAccountId = grant.accountId;
						this.options.put({
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
	private guard(policy: WatchingPolicy, snapshot: WatchingSnapshot) {
		if (
			this.options.signal.aborted ||
			this.options.policy().revision !== policy.revision ||
			this.options.reason(policy) !== "ready" ||
			this.options.snapshot().revision !== snapshot.revision
		)
			watchingConflict();
	}
}
