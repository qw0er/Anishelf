import { eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { TrackingListCache } from "../domain/list.js";
import type { TrackingListStore } from "../ports.js";
import { readTrackingListCache, writeTrackingListCache } from "./records.js";
import { trackingListCache } from "./schema.js";
/** A complete account snapshot and its entries are replaced in one transaction. */
export class TrackingListRepository implements TrackingListStore {
	constructor(private readonly store: Store) {}
	read(accountId: string): TrackingListCache | undefined {
		const row = this.store
			.select()
			.from(trackingListCache)
			.where(eq(trackingListCache.accountId, accountId))
			.get();
		return row ? readTrackingListCache(this.store, row) : undefined;
	}
	replace(cache: TrackingListCache) {
		writeTrackingListCache(this.store, {
			...cache,
			invalidated: cache.invalidated ?? false,
		});
	}
}
