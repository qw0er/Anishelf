import { randomUUID } from "node:crypto";
import type { Subscription } from "../domain/model.js";
import {
	acquisitionProfileFingerprint,
	builtinAcquisitionProfiles,
	defaultAcquisitionProfileId,
} from "../domain/profiles.js";
import type { SubscriptionsContext } from "./context.js";
import type { SubscriptionDiscovery } from "./discovery.js";

/** A persisted subscription may wait for a site; no download permission exists until binding succeeds. */
export class PendingSubscriptions {
	private running: Promise<void> | undefined;
	constructor(
		private readonly context: SubscriptionsContext,
		private readonly discovery: SubscriptionDiscovery,
	) {}
	tick(): Promise<void> {
		if (this.running) return this.running;
		const task = this.run().finally(() => {
			this.running = undefined;
		});
		this.running = task;
		return task;
	}
	private async run() {
		let attempted = 0;
		for (const sub of this.context.options.store.subscriptions()) {
			if (
				!sub.enabled ||
				sub.feedId ||
				!sub.automatic ||
				sub.automatic.retryAt > this.context.now()
			)
				continue;
			if (attempted++ >= 5) break;
			await this.resolve(sub);
		}
	}
	async resolve(sub: Subscription, force = false) {
		const { options } = this.context,
			scope = sub.automatic;
		if (
			!scope ||
			sub.feedId ||
			!sub.enabled ||
			(!force && scope.retryAt > this.context.now())
		)
			return;
		const current = () =>
			!this.context.signal.aborted &&
			options.store.subscription(sub.workKey)?.revision === sub.revision;
		const permitted = () => {
			const profile = (options.profiles ?? builtinAcquisitionProfiles).find(
				(profile) =>
					profile.id ===
					(sub.profileId ??
						options.defaultProfileId?.() ??
						defaultAcquisitionProfileId),
			);
			const target = options.downloadTarget?.();
			return (
				options.sources.connector.settings().generation ===
					scope.sourceGeneration &&
				profile &&
				acquisitionProfileFingerprint(profile) === scope.profileFingerprint &&
				(!scope.target ||
					(target?.validated &&
						target.revision === scope.target.destinationRevision &&
						target.connectionGeneration === scope.target.connectionGeneration))
			);
		};
		let discovery = sub.discovery;
		const retain = (reason: string, retryAt = 0) => {
			if (!current()) return;
			options.store.saveSubscription(
				{
					...sub,
					lastError: reason,
					...(discovery ? { discovery } : {}),
					automatic: {
						...scope,
						retryAt: Math.max(this.context.now() + 300000, retryAt),
					},
				},
				[],
			);
			options.logger.info(
				{
					event: "acquisition.subscription_discovery_deferred",
					workKey: sub.workKey,
					reason,
				},
				"Subscription retained for background discovery.",
			);
		};
		if (!current()) return;
		if (!permitted()) {
			retain("authorization_required");
			return;
		}
		discovery = { checkedAt: this.context.now(), attempts: [] };
		try {
			const result = await this.discovery.search({
				workKey: sub.workKey,
				revision: sub.revision,
				startEpisode: sub.startEpisode,
				profileId: sub.profileId ?? null,
			});
			if (!current()) return;
			if (!permitted()) {
				retain("authorization_required");
				return;
			}
			discovery = { checkedAt: this.context.now(), attempts: result.attempts };
			if (!result.source) {
				const limited =
					result.attempts.length > 0 &&
					result.attempts.every((attempt) => attempt.code === "rate_limited");
				if (limited) {
					retain(
						"rate_limited",
						Math.min(
							...result.attempts.map(
								(attempt) => attempt.retryAt ?? this.context.now() + 300000,
							),
						),
					);
					return;
				}
				retain(
					result.attempts.some((attempt) => attempt.outcome === "unavailable")
						? "discovery_unavailable"
						: "no_eligible_source",
				);
				return;
			}
			const source = result.source;
			options.store.transaction(() => {
				if (!current() || !permitted()) return;
				const feed = options.sources.snapshot(source);
				if (!feed) return;
				const resolved = {
					...sub,
					sourceInput: result.source,
					feedId: feed.id,
					lastError: null,
					...(discovery ? { discovery } : {}),
					revision: randomUUID(),
					automatic: null,
				};
				options.store.saveSubscription(resolved, []);
				if (scope.target)
					options.store.authorize({
						workKey: sub.workKey,
						feedId: feed.id,
						startEpisode: sub.startEpisode,
						...scope.target,
					});
				options.logger.info(
					{
						event: "acquisition.subscription_source_bound",
						workKey: sub.workKey,
						sourceId: feed.id,
						revision: resolved.revision,
					},
					"Background discovery bound the subscription and its accepted download scope.",
				);
			});
		} catch {
			retain("discovery_unavailable");
		}
	}
}
