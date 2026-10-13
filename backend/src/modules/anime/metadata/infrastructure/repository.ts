import { and, asc, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { MetadataFailure } from "../domain/model.js";
import type { ArtworkRecord, CacheEntry, MetadataStore } from "../ports.js";
import { metadataArtwork, metadataPins, metadataSnapshots } from "./schema.js";
export class MetadataRepository implements MetadataStore {
	constructor(private readonly store: Store) {}
	find(key: string): CacheEntry | null {
		return (
			this.store
				.select()
				.from(metadataSnapshots)
				.where(eq(metadataSnapshots.key, key))
				.orderBy(
					desc(metadataSnapshots.fetchedAt),
					desc(sql`${metadataSnapshots}.rowid`),
				)
				.get() ?? null
		);
	}
	get(id: string): CacheEntry | null {
		return (
			this.store
				.select()
				.from(metadataSnapshots)
				.where(eq(metadataSnapshots.id, id))
				.get() ?? null
		);
	}
	save(entry: CacheEntry): void {
		this.store
			.insert(metadataSnapshots)
			.values(entry)
			.onConflictDoUpdate({ target: metadataSnapshots.id, set: entry })
			.run();
	}
	fail(id: string, failure: MetadataFailure): void {
		this.store
			.update(metadataSnapshots)
			.set({ failure })
			.where(eq(metadataSnapshots.id, id))
			.run();
	}
	touch(id: string, now: number): void {
		this.store
			.update(metadataSnapshots)
			.set({ accessedAt: now })
			.where(eq(metadataSnapshots.id, id))
			.run();
	}
	retain(id: string, owner: string): void {
		this.store
			.insert(metadataPins)
			.values({ snapshotId: id, ownerId: owner })
			.onConflictDoNothing()
			.run();
	}
	release(id: string, owner: string): void {
		this.store
			.delete(metadataPins)
			.where(
				and(eq(metadataPins.snapshotId, id), eq(metadataPins.ownerId, owner)),
			)
			.run();
	}
	prune(searchLimit: number, snapshotLimit: number): void {
		this.store.transaction(() => {
			const pinned = this.store
				.select({ id: metadataPins.snapshotId })
				.from(metadataPins);
			for (const [search, limit] of [
				[true, searchLimit],
				[false, snapshotLimit],
			] as const) {
				const rows = this.store
					.select({ id: metadataSnapshots.id })
					.from(metadataSnapshots)
					.where(
						and(
							search
								? eq(metadataSnapshots.kind, "search")
								: ne(metadataSnapshots.kind, "search"),
							notInArray(metadataSnapshots.id, pinned),
						),
					)
					.orderBy(
						desc(metadataSnapshots.accessedAt),
						desc(metadataSnapshots.fetchedAt),
					)
					.all();
				for (const row of rows.slice(limit))
					this.store
						.delete(metadataSnapshots)
						.where(eq(metadataSnapshots.id, row.id))
						.run();
			}
		});
	}
	artworks(): ArtworkRecord[] {
		return this.store
			.select()
			.from(metadataArtwork)
			.orderBy(asc(metadataArtwork.accessedAt))
			.all();
	}
	saveArtwork(record: ArtworkRecord): void {
		this.store
			.insert(metadataArtwork)
			.values(record)
			.onConflictDoUpdate({ target: metadataArtwork.id, set: record })
			.run();
	}
	removeArtwork(id: string): void {
		this.store.delete(metadataArtwork).where(eq(metadataArtwork.id, id)).run();
	}
}
