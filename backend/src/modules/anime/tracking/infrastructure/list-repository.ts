import { eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { TrackingListCache } from "../domain/list.js";
import type { TrackingListStore } from "../ports.js";
import { trackingListCache } from "./schema.js";
/** One complete account snapshot replaces the previous snapshot atomically. */
export class TrackingListRepository implements TrackingListStore {
	constructor(private readonly store: Store) {}
	read(accountId: string): TrackingListCache | undefined {
		return this.store
			.select()
			.from(trackingListCache)
			.where(eq(trackingListCache.accountId, accountId))
			.get();
	}
	replace(cache: TrackingListCache) {
		const value = { ...cache, invalidated: cache.invalidated ?? false };
		this.store
			.insert(trackingListCache)
			.values(value)
			.onConflictDoUpdate({ target: trackingListCache.accountId, set: value })
			.run();
	}
}
