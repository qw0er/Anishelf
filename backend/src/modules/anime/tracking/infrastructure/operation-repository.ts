import { and, eq, sql } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { TrackingOperation } from "../domain/operation.js";
import type { TrackingOperationStore } from "../ports.js";
import { readTrackingOperations, writeTrackingOperations } from "./records.js";
import {
	trackingCommands,
	trackingIntentVersions,
	trackingOperations,
} from "./schema.js";
export class TrackingOperationRepository implements TrackingOperationStore {
	constructor(private readonly store: Store) {}
	list(accountId: string): TrackingOperation[] {
		return this.store
			.select()
			.from(trackingOperations)
			.where(eq(trackingOperations.accountId, accountId))
			.all()
			.map((row) => readTrackingOperations(this.store, row));
	}
	manualVersion(accountId: string, mediaId: string): number {
		return (
			this.store
				.select()
				.from(trackingIntentVersions)
				.where(
					and(
						eq(trackingIntentVersions.accountId, accountId),
						eq(trackingIntentVersions.mediaId, mediaId),
					),
				)
				.get()?.manualVersion ?? 0
		);
	}
	command(accountId: string, commandId: string) {
		return this.store
			.select()
			.from(trackingCommands)
			.where(
				and(
					eq(trackingCommands.accountId, accountId),
					eq(trackingCommands.commandId, commandId),
				),
			)
			.get();
	}
	admit(operation: TrackingOperation): void {
		this.store.transaction(
			() => {
				this.save(operation);
				this.store
					.insert(trackingCommands)
					.values({
						accountId: operation.accountId,
						commandId: operation.commandId,
						operationId: operation.id,
						revision: operation.revision,
					})
					.run();
				if (operation.origin !== "automatic")
					this.store
						.insert(trackingIntentVersions)
						.values({
							accountId: operation.accountId,
							mediaId: operation.mediaId,
							manualVersion: 1,
						})
						.onConflictDoUpdate({
							target: [
								trackingIntentVersions.accountId,
								trackingIntentVersions.mediaId,
							],
							set: {
								manualVersion: sql`${trackingIntentVersions.manualVersion} + 1`,
							},
						})
						.run();
			},
			{ behavior: "immediate" },
		);
	}
	remove(id: string): void {
		this.store
			.delete(trackingOperations)
			.where(eq(trackingOperations.id, id))
			.run();
	}
	save(operation: TrackingOperation): void {
		writeTrackingOperations(this.store, operation);
	}
}
