import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Store } from "../../../../../platform/database/store.js";
import type { ExternalWorkReference } from "../../../../../shared/external-reference.js";
import { workKey } from "../../../../../shared/external-reference.js";
import { metadataDefaults } from "../defaults.js";
import type { MetadataTitle } from "../domain/model.js";
import type { NameEvidence } from "../domain/project-document.js";
import type {
	MetadataFailure,
	Page,
	WorkRelation,
	WorkSummary,
} from "../domain/source-model.js";
import type { ArtworkRecord, CacheEntry, MetadataStore } from "../ports.js";
import {
	metadataArtwork,
	metadataPins,
	metadataReferences,
	metadataSnapshots,
	metadataWorks,
} from "./schema.js";
import { saveWorkSummary } from "./works.js";
export class MetadataRepository implements MetadataStore {
	constructor(private readonly store: Store) {}
	titles(
		references: readonly ExternalWorkReference[],
	): ReadonlyMap<string, readonly MetadataTitle[]> {
		if (!references.length) return new Map();
		const projectWorks = alias(metadataWorks, "library_project_titles");
		const projectSnapshots = alias(metadataSnapshots, "library_project_proof");
		const result = new Map<string, readonly MetadataTitle[]>();
		// Bound SQL parameter counts while retaining a single ownership boundary for titles.
		for (let offset = 0; offset < references.length; offset += 200) {
			const rows = this.store
				.select({
					source: metadataWorks,
					project: projectWorks,
					proof: sql<
						string | null
					>`json_extract(${projectSnapshots.data}, '$.nameEvidence')`,
				})
				.from(metadataWorks)
				.leftJoin(
					metadataReferences,
					and(
						eq(metadataReferences.provider, metadataWorks.provider),
						eq(metadataReferences.providerId, metadataWorks.providerId),
					),
				)
				.leftJoin(
					projectWorks,
					and(
						eq(projectWorks.provider, "metadata"),
						eq(projectWorks.providerId, metadataReferences.workId),
					),
				)
				.leftJoin(
					projectSnapshots,
					eq(projectSnapshots.id, projectWorks.detailSnapshotId),
				)
				.where(
					inArray(
						metadataWorks.key,
						references.slice(offset, offset + 200).map(workKey),
					),
				)
				.all();
			const documents = rows.map((row) => ({
				...row,
				evidence: row.proof ? (JSON.parse(row.proof) as NameEvidence) : null,
			}));
			const peerKeys = [
				...new Set(
					documents.flatMap(({ evidence }) =>
						evidence ? [workKey(evidence.peer)] : [],
					),
				),
			];
			const peers = new Map(
				peerKeys.length
					? this.store
							.select({
								key: metadataWorks.key,
								version: metadataWorks.detailSnapshotId,
							})
							.from(metadataWorks)
							.where(inArray(metadataWorks.key, peerKeys))
							.all()
							.map((row) => [row.key, row.version])
					: [],
			);
			for (const { source, project, evidence } of documents) {
				const valid =
					!evidence ||
					(evidence.verificationVersion ===
						metadataDefaults.nameVerificationVersion &&
						evidence.originSnapshotId === source.detailSnapshotId &&
						peers.get(workKey(evidence.peer)) === evidence.peerSnapshotId);
				result.set(
					source.key,
					valid && project?.titles.length ? project.titles : source.titles,
				);
			}
		}
		return result;
	}
	identify(reference: ExternalWorkReference): string {
		return this.store.transaction(() => {
			const existing = this.store
				.select()
				.from(metadataReferences)
				.where(
					and(
						eq(metadataReferences.provider, reference.provider),
						eq(metadataReferences.providerId, reference.id),
					),
				)
				.get();
			if (existing) return existing.workId;
			const id = randomUUID();
			this.store
				.insert(metadataReferences)
				.values({
					id,
					workId: id,
					provider: reference.provider,
					providerId: reference.id,
				})
				.run();
			return id;
		});
	}
	identity(id: string): string | null {
		return (
			this.store
				.select()
				.from(metadataReferences)
				.where(eq(metadataReferences.id, id))
				.get()?.workId ?? null
		);
	}
	references(id: string): ExternalWorkReference[] {
		const workId = this.identity(id);
		if (!workId) return [];
		return this.store
			.select()
			.from(metadataReferences)
			.where(eq(metadataReferences.workId, workId))
			.orderBy(
				asc(metadataReferences.provider),
				asc(metadataReferences.providerId),
			)
			.all()
			.map((row) => ({
				provider: row.provider,
				id: row.providerId,
				mediaType: "anime",
			}));
	}
	private decode(row: typeof metadataSnapshots.$inferSelect): CacheEntry {
		return {
			id: row.id,
			key: row.key,
			kind: row.kind,
			data: row.data,
			fetchedAt: row.fetchedAt,
			expiresAt: row.expiresAt,
			accessedAt: row.accessedAt,
			failure:
				row.failurePresent &&
				row.failureCode !== null &&
				row.failureMessage !== null
					? {
							code: row.failureCode,
							message: row.failureMessage,
							retryAt: row.failureRetryAt,
						}
					: null,
		};
	}
	current(key: string): CacheEntry | null {
		const row = this.store
			.select({ snapshot: metadataSnapshots })
			.from(metadataWorks)
			.innerJoin(
				metadataSnapshots,
				eq(metadataSnapshots.id, metadataWorks.detailSnapshotId),
			)
			.where(eq(metadataWorks.key, key))
			.get();
		return row ? this.decode(row.snapshot) : null;
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
		const { failure, ...value } = entry;
		const row = {
			...value,
			failurePresent: Boolean(failure),
			failureCode: failure?.code ?? null,
			failureMessage: failure?.message ?? null,
			failureRetryAt: failure?.retryAt ?? null,
		};
		this.store.transaction((store) => {
			store
				.insert(metadataSnapshots)
				.values(row)
				.onConflictDoUpdate({ target: metadataSnapshots.id, set: row })
				.run();
			if (entry.key.startsWith("project:")) {
				if (entry.kind === "detail") {
					const document = entry.data as {
						project: { data: import("../domain/model.js").WorkDetails };
						sourceIds: string[];
						nameEvidence?: NameEvidence;
						artwork: { cover?: WorkSummary };
					};
					const work = document.project.data;
					saveWorkSummary(
						store,
						{
							...work,
							coverUrl: document.artwork.cover?.coverUrl ?? null,
							reference: {
								provider: "metadata",
								mediaType: "anime",
								id: work.reference.id,
							},
						},
						Math.max(
							entry.fetchedAt,
							...(document.sourceIds ?? [])
								.filter((id) => id !== document.nameEvidence?.peerSnapshotId)
								.map(
									(sourceId) =>
										this.get(sourceId)?.fetchedAt ?? entry.fetchedAt,
								),
						),
						true,
						entry.id,
					);
				}
				return;
			}
			if (entry.kind === "detail")
				saveWorkSummary(
					store,
					entry.data as WorkSummary,
					entry.fetchedAt,
					true,
					entry.id,
				);
			if (entry.kind === "search")
				for (const work of (entry.data as Page<WorkSummary>).items)
					saveWorkSummary(store, work, entry.fetchedAt);
			if (entry.kind === "relations")
				for (const relation of (entry.data as Page<WorkRelation>).items)
					saveWorkSummary(store, relation.work, entry.fetchedAt);
		});
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
							sql`${metadataSnapshots.id} not in (select ${metadataWorks.detailSnapshotId} from ${metadataWorks} where ${metadataWorks.detailSnapshotId} is not null)`,
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
	artwork(id: string): ArtworkRecord | null {
		return (
			this.store
				.select()
				.from(metadataArtwork)
				.where(eq(metadataArtwork.id, id))
				.get() ?? null
		);
	}
	artworkByKey(key: string): ArtworkRecord | null {
		return (
			this.store
				.select()
				.from(metadataArtwork)
				.where(eq(metadataArtwork.key, key))
				.orderBy(desc(metadataArtwork.accessedAt))
				.limit(1)
				.get() ?? null
		);
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
