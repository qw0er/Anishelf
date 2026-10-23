import type { Store } from "../../../../platform/database/store.js";
import type { TrackingConnection } from "../domain/model.js";
import type { TrackingStore } from "../ports.js";
import { trackingConnection } from "./schema.js";
export class TrackingRepository implements TrackingStore {
	constructor(private readonly store: Store) {}
	get(): TrackingConnection | undefined {
		const row = this.store.select().from(trackingConnection).get();
		if (!row) return undefined;
		return {
			generation: row.generation,
			account:
				row.accountId !== null && row.accountName !== null
					? { id: row.accountId, name: row.accountName }
					: null,
			credentialId: row.credentialId,
			state: row.state,
			checkedAt: row.checkedAt,
		};
	}
	save(connection: TrackingConnection) {
		const value = {
			id: 1,
			generation: connection.generation,
			accountId: connection.account?.id ?? null,
			accountName: connection.account?.name ?? null,
			credentialId: connection.credentialId,
			state: connection.state,
			checkedAt: connection.checkedAt,
		};
		this.store
			.insert(trackingConnection)
			.values(value)
			.onConflictDoUpdate({ target: trackingConnection.id, set: value })
			.run();
	}
}
