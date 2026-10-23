import { randomUUID } from "node:crypto";
import type { SourceContext } from "../context.js";
import { type FeedRecord, SourceError } from "../domain/model.js";
import { sourcePolicy as policy } from "../policy.js";
import type { RssSourceOptions } from "./ports.js";

export class FeedReader {
	constructor(
		private readonly context: SourceContext,
		private readonly options: RssSourceOptions,
	) {}
	async fetch(feed: FeedRecord): Promise<FeedRecord> {
		this.context.open();
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
			...feed,
			revision: randomUUID(),
			entries: [...retained.values()],
			etag: response.etag,
			lastModified: response.lastModified,
			checkedAt: this.context.now(),
			nextAttemptAt: this.context.now() + this.context.refreshIntervalMs(),
			failures: 0,
			error: null,
		};
	}
}
