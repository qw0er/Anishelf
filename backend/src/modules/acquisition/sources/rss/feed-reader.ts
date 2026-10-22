import { randomUUID } from "node:crypto";
import type { SourceContext } from "../context.js";
import { type FeedRecord, SourceError } from "../domain/model.js";
import { sourcePolicy as policy } from "../policy.js";
import type { RssSourceOptions } from "./ports.js";

interface FeedRead {
	feed: FeedRecord;
	previousRevision: string | null;
}
export class FeedReader {
	private readonly fetching = new Map<string, Promise<FeedRead>>();
	constructor(
		private readonly context: SourceContext,
		private readonly options: RssSourceOptions,
	) {}
	fetch(feed: FeedRecord, previousRevision: string | null): Promise<FeedRead> {
		this.context.open();
		const current = this.fetching.get(feed.id);
		if (current) return current;
		if (this.fetching.size >= 2)
			return Promise.reject(new SourceError("source_busy"));
		const task = (async () => {
			const fetch = () =>
				this.options.transport.fetch(feed.url, feed, this.context.signal);
			const response = await (this.options.gate
				? this.options.gate.run(null, this.context.signal, fetch)
				: fetch());
			if (response.xml === null && feed.checkedAt === null)
				throw new SourceError("invalid_response");
			const entries =
				response.xml === null ? feed.entries : this.options.parse(response.xml);
			const retained = new Map(feed.entries.map((entry) => [entry.id, entry]));
			for (const entry of entries)
				retained.set(
					entry.id,
					response.xml === null
						? entry
						: {
								...entry,
								seedersObservedAt:
									entry.seeders == null ? null : this.context.now(),
							},
				);
			if (retained.size > policy.maximumRetainedItems)
				throw new SourceError("storage_limit");
			return {
				previousRevision,
				feed: {
					...feed,
					revision: randomUUID(),
					entries: [...retained.values()],
					etag: response.etag,
					lastModified: response.lastModified,
					checkedAt: this.context.now(),
					nextAttemptAt: this.context.now() + this.context.refreshIntervalMs(),
					failures: 0,
					error: null,
				},
			};
		})();
		this.fetching.set(feed.id, task);
		void task.finally(() => this.fetching.delete(feed.id)).catch(() => {});
		return task;
	}
	async close() {
		await Promise.allSettled(this.fetching.values());
	}
}
