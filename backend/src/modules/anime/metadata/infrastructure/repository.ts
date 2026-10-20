import { and, asc, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type {
	AiringEpisode,
	MetadataFailure,
	Page,
	WorkDetails,
	WorkRelation,
	WorkSummary,
} from "../domain/model.js";
import type { ArtworkRecord, CacheEntry, MetadataStore } from "../ports.js";
import { readMetadataSnapshots, writeMetadataSnapshots } from "./records.js";
import { metadataArtwork, metadataPins, metadataSnapshots } from "./schema.js";
import type { NormalizedSnapshot } from "./snapshot-record.js";
export class MetadataRepository implements MetadataStore {
	constructor(private readonly store: Store) {}
	private decode(row: typeof metadataSnapshots.$inferSelect): CacheEntry {
		const value = readMetadataSnapshots(this.store, row);
		const {
			detail,
			items,
			relations,
			airing,
			page,
			perPage,
			hasNextPage,
			...entry
		} = value;
		return {
			...entry,
			data:
				value.kind === "detail"
					? detail
					: {
							items:
								value.kind === "search"
									? items
									: value.kind === "relations"
										? relations
										: airing,
							page: page ?? 1,
							perPage: perPage ?? 50,
							hasNextPage: hasNextPage ?? false,
						},
		};
	}
	find(key: string): CacheEntry | null {
		const row = this.store
			.select()
			.from(metadataSnapshots)
			.where(eq(metadataSnapshots.key, key))
			.orderBy(
				desc(metadataSnapshots.fetchedAt),
				desc(sql`${metadataSnapshots}.rowid`),
			)
			.get();
		return row ? this.decode(row) : null;
	}
	get(id: string): CacheEntry | null {
		const row = this.store
			.select()
			.from(metadataSnapshots)
			.where(eq(metadataSnapshots.id, id))
			.get();
		return row ? this.decode(row) : null;
	}
	save(entry: CacheEntry): void {
		const data = entry.data as Page<WorkSummary | WorkRelation | AiringEpisode>;
		const value: NormalizedSnapshot = {
			...entry,
			page: entry.kind === "detail" ? null : data.page,
			perPage: entry.kind === "detail" ? null : data.perPage,
			hasNextPage: entry.kind === "detail" ? null : data.hasNextPage,
			detail: entry.kind === "detail" ? (entry.data as WorkDetails) : null,
			items: entry.kind === "search" ? (data.items as WorkSummary[]) : [],
			relations:
				entry.kind === "relations" ? (data.items as WorkRelation[]) : [],
			airing: entry.kind === "airing" ? (data.items as AiringEpisode[]) : [],
		};
		writeMetadataSnapshots(this.store, value);
	}
	fail(id: string, failure: MetadataFailure): void {
		this.store
			.update(metadataSnapshots)
			.set({
				failurePresent: true,
				failureCode: failure.code,
				failureMessage: failure.message,
				failureRetryAt: failure.retryAt,
			})
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
