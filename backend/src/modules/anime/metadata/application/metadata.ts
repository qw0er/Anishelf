import type { Logger } from "pino";
import type { ExternalWorkReference } from "../../../../shared/external-reference.js";
import { workReference } from "../../../../shared/external-reference.js";
import type {
	CachedMetadata,
	MetadataSnapshot,
	Page,
	ReadOptions,
	SearchRequest,
	WorkDetails,
	WorkReference,
	WorkRelation,
	WorkSummary,
} from "../domain/model.js";
import { MetadataError } from "../domain/model.js";
import type * as Source from "../domain/source-model.js";
import type { MetadataStore, SourceMetadataApi } from "../ports.js";
import type { MetadataApi } from "../public.js";

/** The public Metadata boundary projects source evidence into project-owned identities. */
export class MetadataApplication implements MetadataApi {
	constructor(
		private readonly source: SourceMetadataApi,
		private readonly store: MetadataStore,
		private readonly logger?: Logger,
	) {}
	referenceForExternal(reference: ExternalWorkReference): WorkReference {
		const id = this.storage(() => this.store.identify(reference));
		this.logger?.trace(
			{ event: "metadata.work_identity_resolved", workId: id },
			"Project metadata identity resolved.",
		);
		return { id };
	}
	/** Composition-only bridge for Catalog and Tracking's explicit external associations. */
	externalReference(reference: WorkReference): ExternalWorkReference {
		const result = this.storage(() => this.store.reference(reference.id));
		if (!result)
			throw new MetadataError({
				code: "not-found",
				message: "Metadata work was not found.",
				retryAt: null,
			});
		return result;
	}
	resolveReference(value: string): WorkReference {
		let external: ExternalWorkReference | null = null;
		try {
			external = workReference(value);
		} catch {}
		if (external)
			return this.referenceForExternal(
				this.source.resolveReference(external.id, external.provider),
			);
		const existing = this.storage(() => this.store.reference(value));
		return existing
			? { id: value }
			: this.referenceForExternal(this.source.resolveReference(value));
	}
	private summary(work: Source.WorkSummary): WorkSummary {
		const data: WorkSummary = {
			unavailableFields: [] as string[],
			reference: this.referenceForExternal(work.reference),
			titles: work.titles,
			year: work.year,
			format: work.format,
			status: work.status,
			episodeCount: work.episodeCount,
			nextAiringEpisode: work.nextAiringEpisode,
			airingSeason: work.airingSeason,
			coverUrl: work.coverUrl ? this.artworkUrl(work.reference, "cover") : null,
		};
		data.unavailableFields = [
			...new Set([
				...Object.entries(data)
					.filter(([, value]) => value === null)
					.map(([field]) => field),
				...work.unavailableFields.filter((field) => Object.hasOwn(data, field)),
			]),
		];
		return data;
	}
	private artworkUrl(
		reference: ExternalWorkReference,
		kind: "cover" | "banner",
	) {
		return `/api/metadata/${this.referenceForExternal(reference).id}/artwork/${kind}/image`;
	}
	private details(work: Source.WorkDetails): WorkDetails {
		const data: WorkDetails = {
			...this.summary(work),
			description: work.description,
			bannerUrl: work.bannerUrl
				? this.artworkUrl(work.reference, "banner")
				: null,
			startDate: work.startDate,
			endDate: work.endDate,
			durationMinutes: work.durationMinutes,
			country: work.country,
			source: work.source,
			genres: work.genres,
			tags: work.tags,
			studios: work.studios.map(({ name }) => ({ name })),
			averageScore: work.averageScore,
			streamingEpisodes: work.streamingEpisodes,
			episodeCatalog: work.episodeCatalog,
		};
		data.unavailableFields = [
			...new Set([
				...Object.entries(data)
					.filter(([, value]) => value === null)
					.map(([field]) => field),
				...work.unavailableFields.filter((field) => Object.hasOwn(data, field)),
			]),
		];
		return data;
	}
	private storage<T>(operation: () => T): T {
		try {
			return operation();
		} catch (cause) {
			if (cause instanceof MetadataError) throw cause;
			this.logger?.error(
				{ event: "metadata.identity_storage_failed", err: cause },
				"Metadata identity storage is unavailable.",
			);
			throw new MetadataError(
				{
					code: "storage-unavailable",
					message: "Metadata identity storage is unavailable.",
					retryAt: null,
				},
				{ cause },
			);
		}
	}
	private async read<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch (cause) {
			if (!(cause instanceof MetadataError)) throw cause;
			throw new MetadataError(
				{
					...cause.failure,
					message: "Metadata could not be loaded. Retry shortly.",
				},
				{ cause },
			);
		}
	}
	private envelope<T, U>(
		value: CachedMetadata<T>,
		project: (data: T) => U,
	): CachedMetadata<U> {
		return {
			...value,
			refreshError: value.refreshError
				? {
						...value.refreshError,
						message: "Metadata refresh failed. Retry shortly.",
					}
				: null,
			data: project(value.data),
		};
	}
	private page<T, U>(page: Page<T>, project: (item: T) => U): Page<U> {
		return { ...page, items: page.items.map(project) };
	}
	async search(request: SearchRequest, options?: ReadOptions) {
		return this.envelope(
			await this.read(() =>
				this.source.search(
					{
						query: request.query,
						...(request.provider ? { provider: request.provider } : {}),
						page: request.page ?? 1,
						perPage: request.perPage ?? 10,
					},
					options,
				),
			),
			(data) => this.page(data, (item) => this.summary(item)),
		);
	}
	async get(reference: WorkReference, options?: ReadOptions) {
		return this.envelope(
			await this.read(() =>
				this.source.get(this.externalReference(reference), options),
			),
			(data) => this.details(data),
		);
	}
	async relations(
		reference: WorkReference,
		page?: number,
		perPage?: number,
		options?: ReadOptions,
	) {
		return this.envelope(
			await this.read(() =>
				this.source.relations(
					this.externalReference(reference),
					page,
					perPage,
					options,
				),
			),
			(data) =>
				this.page(
					data,
					(item): WorkRelation => ({
						type: item.type,
						work: this.summary(item.work),
					}),
				),
		);
	}
	async airing(
		reference: WorkReference,
		page?: number,
		perPage?: number,
		options?: ReadOptions,
	) {
		return this.envelope(
			await this.read(() =>
				this.source.airing(
					this.externalReference(reference),
					page,
					perPage,
					options,
				),
			),
			(data) =>
				this.page(data, (item) => ({
					...item,
					id: String(item.episode),
				})),
		);
	}
	/** Project retained evidence as well as live reads; provenance never crosses this boundary. */
	private project(snapshot: Source.MetadataSnapshot): MetadataSnapshot {
		switch (snapshot.kind) {
			case "search":
				return {
					kind: "search",
					...this.envelope(snapshot, (data) =>
						this.page(data, (item) => this.summary(item)),
					),
				};
			case "detail":
				return {
					kind: "detail",
					...this.envelope(snapshot, (data) => this.details(data)),
				};
			case "relations":
				return {
					kind: "relations",
					...this.envelope(snapshot, (data) =>
						this.page(data, (item) => ({
							type: item.type,
							work: this.summary(item.work),
						})),
					),
				};
			case "airing":
				return {
					kind: "airing",
					...this.envelope(snapshot, (data) =>
						this.page(data, (item) => ({ ...item, id: String(item.episode) })),
					),
				};
		}
	}
	snapshot(id: string) {
		return this.project(this.source.snapshot(id));
	}
	current(reference: WorkReference) {
		const value = this.source.current(this.externalReference(reference));
		return value ? this.envelope(value, (data) => this.details(data)) : null;
	}
	retain(id: string, owner: string) {
		this.source.retain(id, owner);
	}
	release(id: string, owner: string) {
		this.source.release(id, owner);
	}
	artwork(
		reference: WorkReference,
		kind: "cover" | "banner",
		options?: ReadOptions,
	) {
		return this.read(() =>
			this.source.artwork(this.externalReference(reference), kind, options),
		);
	}
	snapshotArtwork(id: string, kind: "cover" | "banner") {
		return this.read(() => this.source.snapshotArtwork(id, kind));
	}
	readArtwork(id: string) {
		return this.source.readArtwork(id);
	}
	close() {
		return this.source.close();
	}
	cachedArtworkId(reference: WorkReference, kind: "cover" | "banner") {
		return this.source.cachedArtworkId(this.externalReference(reference), kind);
	}
}
