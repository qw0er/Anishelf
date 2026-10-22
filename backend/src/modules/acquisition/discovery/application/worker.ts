import type { AcquisitionTarget } from "../../../anime/public.js";
import {
	type Candidate,
	type FeedRecord,
	RssError,
	type Subscription,
} from "../domain/model.js";
import type { DiscoveryContext } from "./context.js";
import type { FeedReader } from "./feed-reader.js";
import { discoveryPolicy as policy } from "./policy.js";
export class DiscoveryWorker {
	private readonly polling = new Map<string, Promise<void>>();
	private timer: ReturnType<typeof setInterval> | undefined;
	private ticking: Promise<void> | undefined;
	constructor(
		private readonly context: DiscoveryContext,
		private readonly reader: FeedReader,
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
			const current = this.context.options.store.feed(feed.id);
			return current && [feed.revision, revision].includes(current.revision);
		};
		try {
			const updated = await this.reader.fetch(feed);
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
			this.context.options.store.saveFeed(updated);
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
			const failures = feed.failures + 1,
				code =
					error instanceof RssError ? error.code : "assessment_unavailable";
			this.context.options.store.saveFeed({
				...feed,
				failures,
				error: code,
				nextAttemptAt:
					this.context.now() +
					Math.min(policy.retryMaximumMs, 60_000 * 2 ** Math.min(failures, 6)),
			});
			this.context.options.logger.warn(
				{ event: "acquisition.discovery_failed", feedId: feed.id, code },
				"RSS discovery will retry.",
			);
		}
	}
	start() {
		this.timer = setInterval(() => {
			void this.tick();
		}, policy.tickMs);
		this.timer.unref();
		void this.tick();
	}
	private tick(): Promise<void> {
		if (this.ticking || this.context.signal.aborted)
			return this.ticking ?? Promise.resolve();
		const task = (async () => {
			const ids = [
				...new Set(
					this.context.options.store
						.subscriptions()
						.filter((subscription) => subscription.enabled)
						.map((subscription) => subscription.feedId),
				),
			];
			const due = ids
				.map((id) => {
					const feed = this.context.options.store.feed(id);
					if (!feed || feed.failures > 0 || feed.checkedAt === null)
						return feed;
					const nextAttemptAt =
						feed.checkedAt + this.context.refreshIntervalMs();
					if (nextAttemptAt === feed.nextAttemptAt) return feed;
					const updated = { ...feed, nextAttemptAt };
					this.context.options.store.saveFeed(updated);
					this.context.options.logger.debug(
						{
							event: "acquisition.feed_rescheduled",
							feedId: feed.id,
							nextAttemptAt,
						},
						"RSS refresh schedule updated.",
					);
					return updated;
				})
				.filter((feed): feed is FeedRecord =>
					Boolean(feed && feed.nextAttemptAt <= this.context.now()),
				);
			for (
				let index = 0;
				index < due.length && !this.context.signal.aborted;
				index += 2
			)
				await Promise.all(
					due.slice(index, index + 2).map((feed) => this.pollFeed(feed)),
				);
		})().catch(() => {
			this.context.options.logger.warn(
				{ event: "acquisition.scheduler_failed" },
				"RSS scheduler will retry.",
			);
		});
		this.ticking = task;
		void task.finally(() => {
			this.ticking = undefined;
		});
		return task;
	}
	async close() {
		if (this.timer) clearInterval(this.timer);
		await this.ticking;
		await Promise.allSettled(this.polling.values());
	}
}
