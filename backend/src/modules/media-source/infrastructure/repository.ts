import { isAbsolute } from "node:path";
import { eq } from "drizzle-orm";
import {
	mediaSources,
	resourceRoots,
} from "../../../platform/database/schema.js";
import type { Store } from "../../../platform/database/store.js";
import { resourceRootId, sourceIdentityKey } from "../domain/identity.js";
import type { RegisteredSource, SourceIdentity } from "../domain/model.js";

type MediaSourceRow = typeof mediaSources.$inferSelect;
function toRegisteredSource(row: MediaSourceRow): RegisteredSource {
	return {
		id: row.id,
		rootId: row.rootId,
		fileId: row.fileId,
		relativePath: row.relativePath,
		sourceVersion: row.sourceVersion,
		createdAtMs: row.createdAtMs,
	};
}

function integer(value: number, minimum: number): void {
	if (!Number.isSafeInteger(value) || value < minimum)
		throw new RangeError(
			"Expected a nonnegative safe integer within the supported range.",
		);
}
export class SourceRepository {
	constructor(private readonly store: Store) {}
	registerSource(
		identity: SourceIdentity,
		nowMs = Date.now(),
	): RegisteredSource {
		integer(nowMs, 0);
		if (
			!isAbsolute(identity.canonicalRoot) ||
			identity.canonicalRoot.includes("\0") ||
			!identity.fileId ||
			!identity.sourceVersion ||
			!identity.relativePath ||
			isAbsolute(identity.relativePath) ||
			identity.relativePath.includes("\0") ||
			identity.relativePath.split(/[\\/]/).includes("..")
		) {
			throw new Error(
				"A canonical root and confined source identity are required.",
			);
		}
		const rootId = resourceRootId(identity.canonicalRoot);
		const id = sourceIdentityKey(
			"source",
			rootId,
			identity.fileId,
			identity.sourceVersion,
		);
		return this.store.transaction(
			(tx) => {
				tx.insert(resourceRoots)
					.values({
						id: rootId,
						canonicalPath: identity.canonicalRoot,
						createdAtMs: nowMs,
					})
					.onConflictDoNothing()
					.run();
				tx.insert(mediaSources)
					.values({
						id,
						rootId,
						fileId: identity.fileId,
						relativePath: identity.relativePath,
						sourceVersion: identity.sourceVersion,
						createdAtMs: nowMs,
					})
					.onConflictDoNothing()
					.run();
				const source = tx
					.select()
					.from(mediaSources)
					.where(eq(mediaSources.id, id))
					.get();
				if (!source) throw new Error("Source registration failed.");
				return toRegisteredSource(source);
			},
			{ behavior: "immediate" },
		);
	}
}
