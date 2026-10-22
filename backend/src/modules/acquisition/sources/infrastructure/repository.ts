import { eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { FeedRecord } from "../domain/model.js";
import type { SourceStore } from "../ports.js";
import { readAcquisitionFeeds, writeAcquisitionFeeds } from "./records.js";
import { acquisitionFeeds as feeds } from "./schema.js";
export class SourceRepository implements SourceStore {
	constructor(private readonly store: Store) {}
	feed(id: string) {
		const row = this.store.select().from(feeds).where(eq(feeds.id, id)).get();
		return row ? readAcquisitionFeeds(this.store, row) : null;
	}
	saveFeed(feed: FeedRecord) {
		writeAcquisitionFeeds(this.store, feed);
	}
}
