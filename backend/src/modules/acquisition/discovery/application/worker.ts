import type { AcquisitionTarget } from "../../../anime/public.js";
import { type FeedRecord, RssError } from "../../sources/public.js";
import type { Candidate, Subscription } from "../domain/model.js";
import type { DiscoveryContext } from "./context.js";
export class DiscoveryWorker {
	private readonly polling = new Map<string, Promise<void>>();
	constructor(
		private readonly context: DiscoveryContext,
		private readonly evaluateFeedCandidates: (
			subscription: Subscription,
			feed: FeedRecord,
			target: AcquisitionTarget,
		) => Promise<Candidate[]>,
	) {}
	pollFeed(feed: FeedRecord): Promise<void> {
		const current = this.polling.get(feed.id);
		if (current) return current;
		const task = this.runFeed(feed);
		this.polling.set(feed.id, task);
		void task.finally(() => this.polling.delete(feed.id)).catch(() => {});
		return task;
	}
	private async runFeed(feed: FeedRecord) {
		const canPublish = (revision = feed.revision) => {
			const current = this.context.options.sources.feed(feed.id);
			return current && [feed.revision, revision].includes(current.revision);
		};
		try {
			const updated = await this.context.options.sources.fetch(feed);
			this.context.open();
			if (!canPublish(updated.revision)) return;
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
					if (!canPublish(updated.revision)) return;
					this.context.options.store.updateCandidates(subscription, candidates);
				} catch {
					if (this.context.signal.aborted || !canPublish(updated.revision))
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
			if (!canPublish(updated.revision)) return;
			this.context.options.sources.saveFeed(updated);
			this.context.options.logger.info(
				{
					event: "acquisition.discovery_completed",
					feedId: feed.id,
					entries: updated.entries.length,
				},
				"RSS discovery completed.",
			);
		} catch (error) {
			if (this.context.signal.aborted || !canPublish()) return;
			const code =
				error instanceof RssError ? error.code : "assessment_unavailable";
			this.context.options.sources.failed(feed, code);
			this.context.options.logger.warn(
				{ event: "acquisition.discovery_failed", feedId: feed.id, code },
				"RSS discovery will retry.",
			);
		}
	}
	async close() {
		await Promise.allSettled(this.polling.values());
	}
}
