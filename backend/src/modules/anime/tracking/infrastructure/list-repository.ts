import { eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { TrackingListCache } from "../domain/list.js";
import type { TrackingListStore } from "../ports.js";
import { trackingListCache } from "./schema.js";
/** One complete account snapshot replaces the previous snapshot atomically. */
export class TrackingListRepository implements TrackingListStore {
	constructor(private readonly store: Store) {}
	read(accountId: number): TrackingListCache | undefined {
		return this.store
			.select()
			.from(trackingListCache)
			.where(eq(trackingListCache.accountId, accountId))
			.get();
	}
	replace(cache: TrackingListCache) {
		this.store
			.insert(trackingListCache)
			.values(cache)
			.onConflictDoUpdate({ target: trackingListCache.accountId, set: cache })
			.run();
	}
}
