import { eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { TrackingOperation } from "../domain/operation.js";
import type { TrackingOperationStore } from "../ports.js";
import { trackingOperations } from "./schema.js";
export class TrackingOperationRepository implements TrackingOperationStore {
	constructor(private readonly store: Store) {}
	list(accountId: number): TrackingOperation[] {
		return this.store
			.select()
			.from(trackingOperations)
			.where(eq(trackingOperations.accountId, accountId))
			.all()
			.map((row) => row.operation);
	}
	remove(id: string): void {
		this.store
			.delete(trackingOperations)
			.where(eq(trackingOperations.id, id))
			.run();
	}
	save(operation: TrackingOperation): void {
		this.store
			.insert(trackingOperations)
			.values({
				id: operation.id,
				accountId: operation.accountId,
				mediaId: operation.mediaId,
				operation,
			})
			.onConflictDoUpdate({ target: trackingOperations.id, set: { operation } })
			.run();
	}
}
