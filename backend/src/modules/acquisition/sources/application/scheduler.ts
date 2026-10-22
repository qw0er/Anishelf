import type { FeedRecord } from "../domain/model.js";
import { sourcePolicy as policy } from "../policy.js";
import type { SourceContext } from "./context.js";
export class SourceScheduler {
	private timer: ReturnType<typeof setInterval> | undefined;
	private ticking: Promise<void> | undefined;
	constructor(
		private readonly context: SourceContext,
		private readonly activeIds: () => string[],
		private readonly poll: (feed: FeedRecord) => Promise<void>,
	) {}
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
			const ids = [...new Set(this.activeIds())];
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
					due.slice(index, index + 2).map((feed) => this.poll(feed)),
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
	}
}
