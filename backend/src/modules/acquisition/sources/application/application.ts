import type { FeedRecord } from "../domain/model.js";
import { sourcePolicy as policy } from "../policy.js";
import type { SourcesApi } from "../public.js";
import { SourceContext, type SourceOptions } from "./context.js";
import { FeedReader } from "./feed-reader.js";
import { SourceScheduler } from "./scheduler.js";
export class SourcesApplication implements SourcesApi {
	private readonly context: SourceContext;
	private readonly reader: FeedReader;
	private scheduler: SourceScheduler | undefined;
	constructor(private readonly options: SourceOptions) {
		this.context = new SourceContext(options);
		this.reader = new FeedReader(this.context);
	}
	normalizeUrl(url: string) {
		return this.options.normalizeUrl(url);
	}
	feed(id: string) {
		return this.options.store.feed(id);
	}
	saveFeed(feed: FeedRecord) {
		this.options.store.saveFeed(feed);
	}
	fetch(feed: FeedRecord) {
		return this.reader.fetch(feed);
	}
	failed(feed: FeedRecord, code: string) {
		const failures = feed.failures + 1;
		this.saveFeed({
			...feed,
			failures,
			error: code,
			nextAttemptAt:
				this.context.now() +
				Math.min(policy.retryMaximumMs, 60_000 * 2 ** Math.min(failures, 6)),
		});
	}
	start(activeIds: () => string[], poll: (feed: FeedRecord) => Promise<void>) {
		this.context.open();
		if (this.scheduler) return;
		this.scheduler = new SourceScheduler(this.context, activeIds, poll);
		this.scheduler.start();
	}
	async close() {
		this.context.shutdown.abort();
		await this.options.transport.close();
		await Promise.allSettled([this.reader.close(), this.scheduler?.close()]);
	}
}
