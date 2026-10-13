import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import { DomainError } from "../../../../shared/errors.js";
import {
	mediaSources,
	resourceRoots,
} from "../../../resources/resource-access/persistence.js";
import type { SourceRegistry } from "../../../resources/resource-access/public.js";
import type { IdentificationResult } from "../../identification/public.js";
import type {
	Association,
	CatalogQuery,
	ConfirmationResult,
	LocalEpisode,
	LocalWork,
	Page,
	ProviderLink,
	ReviewRecord,
} from "../domain/model.js";
import type { CatalogStore } from "../ports.js";
import {
	catalogAssociations,
	catalogEpisodes,
	catalogOperations,
	catalogProviderLinks,
	catalogReviews,
	catalogWorks,
} from "./schema.js";

type Connection = Pick<
	Store,
	"select" | "insert" | "update" | "delete" | "transaction"
>;
export class CatalogRepository implements CatalogStore {
	constructor(
		private readonly store: Connection,
		private readonly sources: SourceRegistry,
	) {}
	registerSource(...args: Parameters<SourceRegistry["registerSource"]>) {
		return this.sources.registerSource(...args);
	}
	transaction<T>(operation: (store: CatalogStore) => T): T {
		return this.store.transaction(
			(tx) => operation(new CatalogRepository(tx, this.sources)),
			{ behavior: "immediate" },
		);
	}
	private readReview(row: {
		review: typeof catalogReviews.$inferSelect;
		source: typeof mediaSources.$inferSelect;
		root: typeof resourceRoots.$inferSelect;
	}): ReviewRecord {
		const result = row.review.result as IdentificationResult;
		return {
			id: row.review.id,
			sourceId: row.source.id,
			rootId: row.source.rootId,
			fileId: row.source.fileId,
			relativePath: row.source.relativePath,
			sourceVersion: row.source.sourceVersion,
			canonicalRoot: row.root.canonicalPath,
			available: row.review.available,
			revision: row.review.revision,
			decision: row.review.decision,
			reason: row.review.reason,
			evidence: result.evidence,
			proposals: result.proposals,
			metadataStatus: result.metadataStatus,
			unresolved: result.unresolved,
		};
	}
	private reviewQuery() {
		return this.store
			.select({
				review: catalogReviews,
				source: mediaSources,
				root: resourceRoots,
			})
			.from(catalogReviews)
			.innerJoin(mediaSources, eq(mediaSources.id, catalogReviews.id))
			.innerJoin(resourceRoots, eq(resourceRoots.id, mediaSources.rootId));
	}
	review(id: string): ReviewRecord | null {
		const row = this.reviewQuery().where(eq(catalogReviews.id, id)).get();
		return row ? this.readReview(row) : null;
	}
	reviews(
		rootId: string,
		decision: ReviewRecord["decision"] | undefined,
		page: number,
		perPage: number,
	): Page<ReviewRecord> {
		const rows = this.reviewQuery()
			.where(
				and(
					eq(mediaSources.rootId, rootId),
					decision ? eq(catalogReviews.decision, decision) : undefined,
				),
			)
			.orderBy(asc(catalogReviews.id))
			.limit(perPage + 1)
			.offset((page - 1) * perPage)
			.all();
		return {
			items: rows.slice(0, perPage).map((row) => this.readReview(row)),
			page,
			perPage,
			hasNextPage: rows.length > perPage,
		};
	}
	publish(rootId: string, items: Parameters<CatalogStore["publish"]>[1]): void {
		this.transaction(() => {
			const rootSources = this.store
				.select({ id: mediaSources.id })
				.from(mediaSources)
				.where(eq(mediaSources.rootId, rootId));
			this.store
				.update(catalogReviews)
				.set({ available: false })
				.where(inArray(catalogReviews.id, rootSources))
				.run();
			for (const { source, result } of items) {
				const previous = this.store
					.select()
					.from(catalogReviews)
					.where(eq(catalogReviews.id, source.id))
					.get();
				const changed =
					!previous ||
					JSON.stringify(previous.result) !== JSON.stringify(result);
				this.store
					.insert(catalogReviews)
					.values({
						id: source.id,
						result,
						available: true,
						revision: 1,
						decision: "pending",
						reason: null,
					})
					.onConflictDoUpdate({
						target: catalogReviews.id,
						set: {
							result,
							available: true,
							revision: (previous?.revision ?? 1) + Number(changed),
						},
					})
					.run();
			}
		});
	}
	work(id: string): LocalWork | null {
		return (
			this.store
				.select()
				.from(catalogWorks)
				.where(eq(catalogWorks.id, id))
				.get() ?? null
		);
	}
	link(workId: string): ProviderLink | null {
		const row = this.store
			.select()
			.from(catalogProviderLinks)
			.where(eq(catalogProviderLinks.workId, workId))
			.get();
		return row
			? {
					workId,
					snapshotId: row.snapshotId,
					reference: {
						provider: row.provider,
						mediaType: row.mediaType,
						id: row.providerId,
					},
				}
			: null;
	}
	findWork(reference: ProviderLink["reference"]): LocalWork | null {
		const row = this.store
			.select({ work: catalogWorks })
			.from(catalogWorks)
			.innerJoin(
				catalogProviderLinks,
				eq(catalogProviderLinks.workId, catalogWorks.id),
			)
			.where(
				and(
					eq(catalogProviderLinks.provider, reference.provider),
					eq(catalogProviderLinks.mediaType, reference.mediaType),
					eq(catalogProviderLinks.providerId, reference.id),
				),
			)
			.get();
		return row?.work ?? null;
	}
	list(
		rootId: string,
		query: CatalogQuery,
		page: number,
		perPage: number,
	): Page<LocalWork> {
		const rootWorks = this.store
			.select({ id: catalogEpisodes.workId })
			.from(catalogEpisodes)
			.innerJoin(
				catalogAssociations,
				eq(catalogAssociations.episodeId, catalogEpisodes.id),
			)
			.innerJoin(
				mediaSources,
				eq(mediaSources.id, catalogAssociations.sourceId),
			)
			.where(eq(mediaSources.rootId, rootId));
		const availableWorks = this.store
			.select({ id: catalogEpisodes.workId })
			.from(catalogEpisodes)
			.innerJoin(
				catalogAssociations,
				eq(catalogAssociations.episodeId, catalogEpisodes.id),
			)
			.innerJoin(
				mediaSources,
				eq(mediaSources.id, catalogAssociations.sourceId),
			)
			.innerJoin(catalogReviews, eq(catalogReviews.id, mediaSources.id))
			.where(
				and(
					eq(mediaSources.rootId, rootId),
					eq(catalogReviews.available, true),
				),
			);
		const pattern = `%${(query.query ?? "").replace(/[\\%_]/g, "\\$&")}%`;
		const title = sql`lower(coalesce(${catalogWorks.title}, ${catalogWorks.providerTitle}))`;
		const rows = this.store
			.select()
			.from(catalogWorks)
			.where(
				and(
					inArray(catalogWorks.id, rootWorks),
					query.query
						? or(
								sql`${title} like ${pattern} escape '\\'`,
								sql`exists (select 1 from json_each(${catalogWorks.aliases}) where value like ${pattern} escape '\\')`,
								sql`exists (select 1 from json_each(${catalogWorks.searchTitles}) where value like ${pattern} escape '\\')`,
							)
						: undefined,
					query.format ? eq(catalogWorks.format, query.format) : undefined,
					query.year !== undefined
						? eq(catalogWorks.year, query.year)
						: undefined,
					query.availability === "available"
						? inArray(catalogWorks.id, availableWorks)
						: query.availability === "unavailable"
							? sql`${catalogWorks.id} not in (${availableWorks})`
							: undefined,
				),
			)
			.orderBy(
				query.sort === "recent" ? desc(catalogWorks.createdAt) : asc(title),
				asc(catalogWorks.id),
			)
			.limit(perPage + 1)
			.offset((page - 1) * perPage)
			.all();
		return {
			items: rows.slice(0, perPage),
			page,
			perPage,
			hasNextPage: rows.length > perPage,
		};
	}
	saveWork(work: LocalWork, link: ProviderLink): void {
		this.store
			.insert(catalogWorks)
			.values(work)
			.onConflictDoUpdate({ target: catalogWorks.id, set: work })
			.run();
		this.store
			.insert(catalogProviderLinks)
			.values({
				workId: work.id,
				snapshotId: link.snapshotId,
				provider: link.reference.provider,
				mediaType: link.reference.mediaType,
				providerId: link.reference.id,
			})
			.onConflictDoUpdate({
				target: catalogProviderLinks.workId,
				set: { snapshotId: link.snapshotId },
			})
			.run();
	}
	episodes(workId: string): LocalEpisode[] {
		return this.store
			.select()
			.from(catalogEpisodes)
			.where(eq(catalogEpisodes.workId, workId))
			.all();
	}
	saveEpisode(episode: LocalEpisode): void {
		this.store
			.insert(catalogEpisodes)
			.values(episode)
			.onConflictDoUpdate({ target: catalogEpisodes.id, set: episode })
			.run();
	}
	associations(sourceId: string) {
		return this.store
			.select({ association: catalogAssociations, episode: catalogEpisodes })
			.from(catalogAssociations)
			.innerJoin(
				catalogEpisodes,
				eq(catalogEpisodes.id, catalogAssociations.episodeId),
			)
			.where(eq(catalogAssociations.sourceId, sourceId))
			.all()
			.map((row) => ({ ...row.association, episode: row.episode }));
	}
	versions(episodeId: string, rootId: string) {
		const rows = this.store
			.select({ association: catalogAssociations })
			.from(catalogAssociations)
			.innerJoin(
				mediaSources,
				eq(mediaSources.id, catalogAssociations.sourceId),
			)
			.where(
				and(
					eq(catalogAssociations.episodeId, episodeId),
					eq(mediaSources.rootId, rootId),
				),
			)
			.orderBy(asc(catalogAssociations.sourceId))
			.all();
		return rows.map((row) => {
			const review = this.review(row.association.sourceId);
			if (!review)
				throw new Error("Associated catalog source has no review record.");
			return { review, association: row.association };
		});
	}
	replaceAssociations(sourceId: string, associations: Association[]): void {
		this.store
			.delete(catalogAssociations)
			.where(eq(catalogAssociations.sourceId, sourceId))
			.run();
		if (associations.length)
			this.store.insert(catalogAssociations).values(associations).run();
	}
	decide(
		id: string,
		revision: number,
		decision: ReviewRecord["decision"],
		reason: string | null,
	): void {
		const result = this.store
			.update(catalogReviews)
			.set({ decision, reason, revision: revision + 1 })
			.where(
				and(eq(catalogReviews.id, id), eq(catalogReviews.revision, revision)),
			)
			.run();
		if (result.changes !== 1)
			throw new DomainError(
				"CATALOG_CONFLICT",
				"Review changed; reopen it before saving.",
			);
	}
	operation(
		key: string,
	): { fingerprint: string; result: ConfirmationResult } | null {
		const row = this.store
			.select()
			.from(catalogOperations)
			.where(eq(catalogOperations.key, key))
			.get();
		return row
			? {
					fingerprint: row.fingerprint,
					result: row.result as ConfirmationResult,
				}
			: null;
	}
	saveOperation(
		key: string,
		fingerprint: string,
		result: ConfirmationResult,
	): void {
		this.store
			.insert(catalogOperations)
			.values({ key, fingerprint, result })
			.run();
	}
}
