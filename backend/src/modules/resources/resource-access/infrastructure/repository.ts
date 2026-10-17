import { isAbsolute } from "node:path";
import { and, eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import { sourceIdentityKey } from "../domain/identity.js";
import type { RegisteredSource, SourceIdentity } from "../domain/model.js";
import { mediaSources, resourceRoots } from "./schema.js";

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
			!/^[A-Za-z0-9_-]{43}$/.test(identity.scopeId) ||
			identity.scopeId.includes("\0") ||
			!identity.fileId ||
			!identity.sourceVersion ||
			!identity.relativePath ||
			isAbsolute(identity.relativePath) ||
			identity.relativePath.includes("\0") ||
			identity.relativePath.split(/[\\/]/).includes("..")
		) {
			throw new Error(
				"An opaque resource scope and confined source identity are required.",
			);
		}
		const rootId = identity.scopeId;
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
						canonicalPath: `scope:${rootId}`,
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
					.where(
						and(
							eq(mediaSources.rootId, rootId),
							eq(mediaSources.fileId, identity.fileId),
							eq(mediaSources.sourceVersion, identity.sourceVersion),
						),
					)
					.get();
				if (!source) throw new Error("Source registration failed.");
				return toRegisteredSource(source);
			},
			{ behavior: "immediate" },
		);
	}
}
