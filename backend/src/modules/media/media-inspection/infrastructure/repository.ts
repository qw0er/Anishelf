import { and, eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { InspectionStore } from "../ports.js";
import { mediaInspections } from "./schema.js";
export class InspectionRepository implements InspectionStore {
	constructor(private readonly store: Store) {}
	find(scopeId: string, fileId: string) {
		return (
			this.store
				.select()
				.from(mediaInspections)
				.where(
					and(
						eq(mediaInspections.scopeId, scopeId),
						eq(mediaInspections.fileId, fileId),
					),
				)
				.get() ?? null
		);
	}
	save(value: Parameters<InspectionStore["save"]>[0]) {
		this.store
			.insert(mediaInspections)
			.values(value)
			.onConflictDoUpdate({
				target: [mediaInspections.scopeId, mediaInspections.fileId],
				set: value,
			})
			.run();
	}
	reconcile(
		scopes: readonly string[],
		files: ReadonlyMap<string, string>,
		configuredScopes: readonly string[],
	) {
		let removed = 0;
		this.store.transaction(() => {
			for (const row of this.store
				.select({
					scopeId: mediaInspections.scopeId,
					fileId: mediaInspections.fileId,
					sourceVersion: mediaInspections.sourceVersion,
				})
				.from(mediaInspections)
				.all())
				if (
					!configuredScopes.includes(row.scopeId) ||
					(scopes.includes(row.scopeId) &&
						files.get(row.fileId) !== row.sourceVersion)
				) {
					this.store
						.delete(mediaInspections)
						.where(
							and(
								eq(mediaInspections.scopeId, row.scopeId),
								eq(mediaInspections.fileId, row.fileId),
							),
						)
						.run();
					removed++;
				}
		});
		return removed;
	}
}
