import type { AcquisitionTarget } from "../../../anime/public.js";
import { SourceError, type SourceSnapshot } from "../../sources/public.js";
import type { Candidate, Subscription } from "../domain/model.js";
import type { DiscoveryContext } from "./context.js";
export class DiscoveryWorker {
	private readonly polling = new Map<string, Promise<void>>();
	constructor(
		private readonly context: DiscoveryContext,
		private readonly evaluateFeedCandidates: (
			subscription: Subscription,
			feed: SourceSnapshot,
			target: AcquisitionTarget,
		) => Promise<Candidate[]>,
	) {}
	pollFeed(feed: SourceSnapshot): Promise<void> {
		const current = this.polling.get(feed.id);
		if (current) return current;
		const task = this.runFeed(feed);
		this.polling.set(feed.id, task);
		void task.finally(() => this.polling.delete(feed.id)).catch(() => {});
		return task;
	}
	private async runFeed(feed: SourceSnapshot) {
		const canPublish = () =>
			this.context.options.sources.snapshot(feed.id)?.revision ===
			feed.revision;
		try {
			const updated = await this.context.options.sources.refresh(
				this.context.options.sources.reference(feed.id),
			);
			this.context.open();
			if (!this.context.options.sources.isCurrent(updated)) return;
			const subscriptions = this.context.options.store
				.subscriptions()
				.filter(
					(subscription) =>
						subscription.enabled && subscription.feedId === feed.id,
				);
			if (!subscriptions.length) return;
			for (const subscription of subscriptions) {
				try {
					const target = await this.context.options.anime.target(
						subscription.workKey,
						this.context.signal,
					);
					const candidates = await this.evaluateFeedCandidates(
						subscription,
						updated,
						target,
					);
					this.context.open();
					if (!this.context.options.sources.isCurrent(updated)) return;
					this.context.options.store.updateCandidates(subscription, candidates);
				} catch {
					if (
						this.context.signal.aborted ||
						!this.context.options.sources.isCurrent(updated)
					)
						return;
					this.context.options.store.updateCandidates(
						subscription,
						this.context.options.store.candidates(subscription.workKey),
						"assessment_unavailable",
					);
					this.context.options.logger.warn(
						{ event: "acquisition.assessment_failed", feedId: feed.id },
						"Subscription assessment will retry.",
					);
				}
			}
			if (!this.context.options.sources.isCurrent(updated)) return;
			this.context.options.sources.publish(updated);
			this.context.options.logger.info(
				{
					event: "acquisition.discovery_completed",
					feedId: feed.id,
					entries: updated.entries.length,
				},
				"Source discovery completed.",
			);
		} catch (error) {
			if (this.context.signal.aborted || !canPublish()) return;
			const code =
				error instanceof SourceError ? error.code : "assessment_unavailable";
			this.context.options.sources.failed(feed, code);
			this.context.options.logger.warn(
				{ event: "acquisition.discovery_failed", feedId: feed.id, code },
				"Source discovery will retry.",
			);
		}
	}
	async close() {
		await Promise.allSettled(this.polling.values());
	}
}
