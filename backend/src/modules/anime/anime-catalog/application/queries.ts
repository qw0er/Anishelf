import { DomainError } from "../../../../shared/errors.js";
import type { CachedMetadata, WorkDetails } from "../../metadata/public.js";
import { conflict, integer, invalid, text } from "../domain/mapping.js";
import type {
	CatalogQuery,
	LocalWork,
	LocalWorkDetail,
	WorkCard,
} from "../domain/model.js";
import { type CatalogContext, page } from "./context.js";

export class CatalogQueries {
	constructor(private readonly context: CatalogContext) {}
	async availableEpisodes(
		reference: import("../../metadata/public.js").ProviderReference,
	) {
		const scope = await this.context.scope();
		const work = this.context.options.store.findWork(reference);
		const episodes = work
			? ((await this.card(work, scope.ids, scope.revision))
					.availableTrackingEpisodes ?? [])
			: [];
		return {
			episodes,
			revision: JSON.stringify([
				scope.revision,
				work?.revision ?? null,
				episodes,
			]),
		};
	}
	private async card(
		work: LocalWork,
		scopeIds: readonly string[],
		epoch: number,
	): Promise<WorkCard> {
		const link = this.context.options.store.link(work.id);
		if (!link) throw new Error("Catalog work is missing its provider link.");
		const availableTrackingEpisodes: number[] = [];
		let availableEpisodes = 0;
		let availableRegularEpisodes = 0;
		const availability = new Map<string, boolean>();
		for (const episode of this.context.options.store.episodes(work.id)) {
			let usable = false;
			for (const { review } of this.context.options.store.versions(
				episode.id,
				scopeIds,
			)) {
				let available = availability.get(review.id);
				if (available === undefined) {
					available = await this.context.available(review, epoch);
					availability.set(review.id, available);
				}
				usable ||= available;
			}
			if (
				usable &&
				(episode.kind === "regular" ||
					(episode.kind === "movie" && episode.number === "1")) &&
				/^[1-9][0-9]*$/.test(episode.number)
			)
				availableTrackingEpisodes.push(Number(episode.number));
			availableEpisodes += Number(usable);
			if (episode.kind === "regular")
				availableRegularEpisodes += Number(usable);
		}
		return {
			...work,
			displayTitle: work.providerTitle,
			hasCover: this.hasArtwork(work.id, "cover"),
			metadataStale: this.snapshot(work.id).stale,
			reference: link.reference,
			availableEpisodes,
			availableRegularEpisodes,
			availableTrackingEpisodes,
		};
	}
	async list(query: CatalogQuery = {}) {
		const scope = await this.context.scope();
		const pagination = page(query);
		if (query.query !== undefined) text(query.query, 200);
		if (query.year !== undefined) integer(query.year, 1, 9999);
		if (query.format !== undefined) text(query.format, 50);
		if (query.sort && !["title", "recent"].includes(query.sort))
			invalid("Unknown catalog sort.");
		if (
			query.availability &&
			!["available", "unavailable"].includes(query.availability)
		)
			invalid("Unknown availability filter.");
		const result = this.context.options.store.list(
			scope.ids,
			query,
			pagination.page,
			pagination.perPage,
		);
		const items: WorkCard[] = [];
		for (const work of result.items)
			items.push(await this.card(work, scope.ids, scope.revision));
		this.context.options.sources.assertAccessRevision(scope.revision);
		return { ...result, items };
	}
	/** Only persisted summaries are scanned; source checks are deferred to selected cards. */
	async index(query: CatalogQuery = {}) {
		const scope = await this.context.scope();
		const items: (LocalWork & {
			reference: WorkCard["reference"];
			available: boolean;
		})[] = [];
		const available = new Set<string>();
		for (let pageNumber = 1; ; pageNumber++) {
			const result = this.context.options.store.list(
				scope.ids,
				{ availability: "available" },
				pageNumber,
				50,
			);
			for (const work of result.items) available.add(work.id);
			if (!result.hasNextPage) break;
		}
		for (let pageNumber = 1; ; pageNumber++) {
			const result = this.context.options.store.list(
				scope.ids,
				query,
				pageNumber,
				50,
			);
			for (const work of result.items) {
				const link = this.context.options.store.link(work.id);
				if (!link) throw new Error("Catalog provider link is missing.");
				items.push({
					...work,
					reference: link.reference,
					available: available.has(work.id),
				});
			}
			if (!result.hasNextPage) break;
		}
		this.context.options.sources.assertAccessRevision(scope.revision);
		return { items, epoch: scope.revision };
	}
	async cards(ids: readonly string[], epoch: number) {
		if (ids.length > 50) invalid("Too many library cards.");
		const scope = await this.context.scope();
		this.context.options.sources.assertAccessRevision(epoch);
		const items: WorkCard[] = [];
		for (const id of ids)
			items.push(
				await this.card(
					this.context.requireWork(id, scope.ids),
					scope.ids,
					epoch,
				),
			);
		this.context.options.sources.assertAccessRevision(epoch);
		return items;
	}
	private snapshot(workId: string): CachedMetadata<WorkDetails> {
		const link = this.context.options.store.link(workId);
		if (!link) throw new Error("Catalog work is missing its provider link.");
		const value = this.context.options.metadata.snapshot(link.snapshotId);
		if (value.kind !== "detail")
			throw new Error("Catalog work requires a detail snapshot.");
		const { kind: _, ...metadata } = value;
		return metadata;
	}
	private hasArtwork(id: string, kind: "cover" | "banner"): boolean {
		const snapshot = this.snapshot(id);
		return Boolean(
			kind === "cover" ? snapshot.data.coverUrl : snapshot.data.bannerUrl,
		);
	}
	async artwork(id: string, kind: "cover" | "banner") {
		const scope = await this.context.scope();
		this.context.requireWork(id, scope.ids);
		const snapshot = this.snapshot(id);
		const status = await this.context.options.metadata.snapshotArtwork(
			snapshot.snapshotId,
			kind,
		);
		this.context.options.sources.assertAccessRevision(scope.revision);
		if (!status.id)
			throw new DomainError(
				"CATALOG_NOT_FOUND",
				"Artwork is unavailable. Retry later.",
			);
		return this.context.options.metadata.readArtwork(status.id);
	}
	async getLocalWorkDetail(id: string): Promise<LocalWorkDetail> {
		const scope = await this.context.scope();
		const work = this.context.requireWork(id, scope.ids);
		const episodes: LocalWorkDetail["episodes"] = [];
		const availability = new Map<string, boolean>();
		for (const episode of this.context.options.store.episodes(id)) {
			const versions: LocalWorkDetail["episodes"][number]["versions"] = [];
			for (const { review, association } of this.context.options.store.versions(
				episode.id,
				scope.ids,
			)) {
				let available = availability.get(review.id);
				if (available === undefined) {
					available = await this.context.available(review, scope.revision);
					availability.set(review.id, available);
				}
				versions.push({
					reviewId: review.id,
					sourceId: review.sourceId,
					fileId: review.fileId,
					relativePath: review.relativePath,
					sourceVersion: review.sourceVersion,
					available,
					evidence: review.evidence,
					mapping: {
						rawNumbers: association.rawNumbers,
						reason: association.reason,
						offset: association.offset,
					},
				});
			}
			episodes.push({
				...episode,
				versions,
				availability: versions.some((version) => version.available)
					? "available"
					: versions.length
						? "unavailable"
						: "missing",
			});
		}
		const order = { regular: 0, special: 1, movie: 2 };
		episodes.sort(
			(a, b) =>
				order[a.kind] - order[b.kind] ||
				a.number.localeCompare(b.number, "en", { numeric: true }) ||
				a.id.localeCompare(b.id),
		);
		this.context.options.sources.assertAccessRevision(scope.revision);
		const link = this.context.options.store.link(id);
		if (!link) throw new Error("Catalog work is missing its provider link.");
		if (this.context.options.store.work(id)?.revision !== work.revision)
			conflict("The work changed while loading its detail. Reload it.");
		return {
			work: {
				...work,
				displayTitle: work.providerTitle,
				hasCover: this.hasArtwork(id, "cover"),
				metadataStale: this.snapshot(id).stale,
				reference: link.reference,
				availableEpisodes: episodes.filter(
					(episode) => episode.availability === "available",
				).length,
				availableRegularEpisodes: episodes.filter(
					(episode) =>
						episode.kind === "regular" && episode.availability === "available",
				).length,
			},
			metadata: this.snapshot(id),
			hasBanner: this.hasArtwork(id, "banner"),
			episodes,
			episodeCountProvenance:
				work.episodeCount === null ? "unknown" : "provider-count",
		};
	}
}
