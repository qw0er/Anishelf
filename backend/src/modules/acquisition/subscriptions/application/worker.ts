import type { AcquisitionTarget } from "../../../anime/public.js";
import { SourceError, type SourceSnapshot } from "../../sources/public.js";
import type { Candidate, Subscription } from "../domain/model.js";
import type { SubscriptionsContext } from "./context.js";
export class SubscriptionWorker {
	private readonly polling = new Map<string, Promise<void>>();
	constructor(
		private readonly context: SubscriptionsContext,
		private readonly evaluateCandidates: (
			subscription: Subscription,
			feed: SourceSnapshot,
			target: AcquisitionTarget,
		) => Promise<Candidate[]>,
	) {}
	pollSource(feed: SourceSnapshot): Promise<void> {
		const current = this.polling.get(feed.id);
		if (current) return current;
		const task = this.runSource(feed);
		this.polling.set(feed.id, task);
		void task.finally(() => this.polling.delete(feed.id)).catch(() => {});
		return task;
	}
	private async runSource(feed: SourceSnapshot) {
		try {
			const owner = this.context.options.store
				.subscriptions()
				.find((item) => this.context.runnable(item) && item.feedId === feed.id);
			if (!owner) return;
			const publication = await this.context.options.sources.fetch(
				owner.sourceInput ?? feed.id,
			);
			const updated = publication.snapshot;
			this.context.open();
			const subscriptions = this.context.options.store
				.subscriptions()
				.filter(
					(subscription) =>
						this.context.runnable(subscription) &&
						subscription.feedId === feed.id,
				);
			if (!subscriptions.length) return;
			const results: {
				subscription: Subscription;
				candidates: Candidate[];
				error: string | null;
				locked: string[];
			}[] = [];
			for (const subscription of subscriptions) {
				const locked =
					this.context.options.lockedCandidates?.(subscription.workKey) ?? [];
				try {
					const target = await this.context.options.anime.target(
						subscription.workKey,
						this.context.signal,
					);
					const candidates = await this.evaluateCandidates(
						subscription,
						updated,
						target,
					);
					results.push({ subscription, candidates, error: null, locked });
				} catch {
					if (this.context.signal.aborted) return;
					results.push({
						subscription,
						candidates: this.context.options.store.candidates(
							subscription.workKey,
						),
						error: "assessment_unavailable",
						locked,
					});
					this.context.options.logger.warn(
						{
							event: "acquisition.assessment_failed",
							workKey: subscription.workKey,
							sourceId: feed.id,
						},
						"Subscription assessment will retry.",
					);
				}
			}
			this.context.open();
			publication.commit(() => {
				// A stopped automatic owner must not prevent a shared manual source from publishing.
				const active = results.filter((result) => {
					const current = this.context.options.store.subscription(
						result.subscription.workKey,
					);
					return current && this.context.runnable(current);
				});
				if (!active.length) throw new SourceError("source_conflict");
				// No await between final checks and all writes. Newly reserved choices invalidate this evaluation.
				for (const result of active) {
					const current = this.context.options.store.subscription(
						result.subscription.workKey,
					);
					const locked =
						this.context.options.lockedCandidates?.(
							result.subscription.workKey,
						) ?? [];
					if (
						!current ||
						!this.context.runnable(current) ||
						current.revision !== result.subscription.revision ||
						JSON.stringify(locked) !== JSON.stringify(result.locked)
					)
						throw new SourceError("source_conflict");
				}
				for (const result of active) {
					if (
						!this.context.options.store.updateCandidates(
							result.subscription,
							result.candidates,
							result.error,
						)
					)
						throw new SourceError("source_conflict");
				}
			});
			this.context.options.logger.info(
				{
					event: "acquisition.subscription_refreshed",
					feedId: feed.id,
					entries: updated.entries.length,
				},
				"Subscription source and candidates published.",
			);
		} catch (error) {
			if (
				this.context.signal.aborted ||
				(error instanceof SourceError && error.code === "source_conflict")
			)
				return;
			this.context.options.logger.warn(
				{
					event: "acquisition.subscription_refresh_failed",
					sourceId: feed.id,
					code:
						error instanceof SourceError
							? error.code
							: "assessment_unavailable",
				},
				"Subscription refresh will retry; source failures are owned by Sources.",
			);
		}
	}
	async close() {
		await Promise.allSettled(this.polling.values());
	}
}
