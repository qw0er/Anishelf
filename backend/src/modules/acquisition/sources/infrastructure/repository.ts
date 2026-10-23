import { eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { FeedRecord } from "../domain/model.js";
import type {
	ManagedSource,
	SourceDownload,
	SourceLifecycleStore,
} from "../lifecycle.js";
import type { SourceStore } from "../ports.js";
import { readAcquisitionFeeds, writeAcquisitionFeeds } from "./records.js";
import {
	acquisitionSourceDownloads,
	acquisitionSources,
	acquisitionFeeds as feeds,
} from "./schema.js";
export class SourceRepository implements SourceStore, SourceLifecycleStore {
	constructor(private readonly store: Store) {}
	transaction(operation: () => void) {
		this.store.transaction(operation, { behavior: "immediate" });
	}
	download(id: string) {
		return (
			this.store
				.select()
				.from(acquisitionSourceDownloads)
				.where(eq(acquisitionSourceDownloads.id, id))
				.get() ?? null
		);
	}
	saveDownload(value: SourceDownload) {
		this.store
			.insert(acquisitionSourceDownloads)
			.values(value)
			.onConflictDoNothing()
			.run();
	}
	feed(id: string) {
		const row = this.store.select().from(feeds).where(eq(feeds.id, id)).get();
		return row ? readAcquisitionFeeds(this.store, row) : null;
	}
	source(id: string) {
		return (
			this.store
				.select()
				.from(acquisitionSources)
				.where(eq(acquisitionSources.id, id))
				.get() ?? null
		);
	}
	sources() {
		return this.store.select().from(acquisitionSources).all();
	}
	saveSource(record: ManagedSource) {
		this.store
			.insert(acquisitionSources)
			.values(record)
			.onConflictDoUpdate({ target: acquisitionSources.id, set: record })
			.run();
	}
	removeSource(id: string) {
		this.store
			.delete(acquisitionSources)
			.where(eq(acquisitionSources.id, id))
			.run();
	}
	saveFeed(feed: FeedRecord) {
		writeAcquisitionFeeds(this.store, feed);
	}
}
