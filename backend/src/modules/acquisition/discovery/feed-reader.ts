import { randomUUID } from "node:crypto";
import type { DiscoveryContext } from "./context.js";
import { type FeedRecord, RssError } from "./domain/model.js";
import { discoveryPolicy as policy } from "./policy.js";
export class FeedReader {
	private readonly fetching = new Map<string, Promise<FeedRecord>>();
	constructor(private readonly context: DiscoveryContext) {}
	fetch(feed: FeedRecord): Promise<FeedRecord> {
		const current = this.fetching.get(feed.id);
		if (current) return current;
		if (this.fetching.size >= 2)
			return Promise.reject(new RssError("source_busy"));
		const task = (async () => {
			const response = await this.context.options.transport.fetch(
				feed.url,
				feed,
				this.context.signal,
			);
			if (response.xml === null && feed.checkedAt === null)
				throw new RssError("invalid_response");
			const entries =
				response.xml === null
					? feed.entries
					: this.context.options.parse(response.xml);
			const retained = new Map(feed.entries.map((entry) => [entry.id, entry]));
			for (const entry of entries) retained.set(entry.id, entry);
			if (retained.size > policy.maximumRetainedItems)
				throw new RssError("storage_limit");
			return {
				...feed,
				revision: randomUUID(),
				entries: [...retained.values()],
				etag: response.etag,
				lastModified: response.lastModified,
				checkedAt: this.context.now(),
				nextAttemptAt: this.context.now() + policy.intervalMs,
				failures: 0,
				error: null,
			};
		})();
		this.fetching.set(feed.id, task);
		void task.finally(() => this.fetching.delete(feed.id)).catch(() => {});
		return task;
	}
}
