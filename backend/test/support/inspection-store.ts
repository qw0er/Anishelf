import type {
	InspectionRecord,
	InspectionStore,
} from "../../src/modules/media/media-inspection/ports.js";
export class MemoryInspectionStore implements InspectionStore {
	private values = new Map<string, InspectionRecord>();
	find(scopeId: string, fileId: string) {
		return structuredClone(this.values.get(`${scopeId}:${fileId}`) ?? null);
	}
	save(value: InspectionRecord) {
		this.values.set(`${value.scopeId}:${value.fileId}`, structuredClone(value));
	}
	reconcile(
		scopes: readonly string[],
		files: ReadonlyMap<string, string>,
		configuredScopes: readonly string[],
	) {
		let removed = 0;
		for (const [key, row] of this.values)
			if (
				!configuredScopes.includes(row.scopeId) ||
				(scopes.includes(row.scopeId) &&
					files.get(row.fileId) !== row.sourceVersion)
			) {
				this.values.delete(key);
				removed++;
			}
		return removed;
	}
}
