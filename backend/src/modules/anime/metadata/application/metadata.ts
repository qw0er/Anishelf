import { createHash } from "node:crypto";
import type { Logger } from "pino";
import type { ExternalWorkReference } from "../../../../shared/external-reference.js";
import { workReference } from "../../../../shared/external-reference.js";
import { metadataDefaults } from "../defaults.js";
import type {
	AiringEpisode,
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
interface ProjectDocument {
	project: MetadataSnapshot;
	sourceIds: string[];
	artwork: Partial<Record<"cover" | "banner", Source.WorkDetails>>;
}
export class MetadataApplication implements MetadataApi {
	constructor(
		private readonly source: SourceMetadataApi,
		private readonly store: MetadataStore,
		private readonly logger?: Logger,
		private readonly canAssociate?: (
			target: WorkReference,
			other: WorkReference,
		) => boolean,
	) {}
	referenceForExternal(reference: ExternalWorkReference): WorkReference {
		const id = this.storage(() => this.store.identify(reference));
		this.logger?.trace(
			{ event: "metadata.work_identity_resolved", workId: id },
			"Project metadata identity resolved.",
		);
		return { id };
	}
	/** Explicit external-system bridge, separate from the public content API. */
	externalReference(
		reference: WorkReference,
		provider?: string,
	): ExternalWorkReference | null {
		const refs = this.references(reference);
		return (
			(provider ? refs.find((ref) => ref.provider === provider) : refs[0]) ??
			null
		);
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
		const existing = this.storage(() => this.store.identity(value));
		return existing
			? { id: existing }
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
	private references(reference: WorkReference) {
		const refs = this.storage(() => this.store.references(reference.id));
		if (!refs[0])
			throw new MetadataError({
				code: "not-found",
				message: "Metadata work was not found.",
				retryAt: null,
			});
		return refs;
	}
	/** Explicit management operation; ordinary consumers never select a source. */
	associate(
		target: WorkReference,
		other: WorkReference,
		confirmation: { sameEpisodeNumbering: true },
	): WorkReference {
		if (confirmation.sameEpisodeNumbering !== true)
			throw new MetadataError({
				code: "invalid-request",
				message:
					"Confirm matching works and equivalent episode numbering before association.",
				retryAt: null,
			});
		const left = this.references(target),
			right = this.references(other);
		const id = this.store.identity(target.id),
			otherId = this.store.identity(other.id);
		if (id === otherId) return { id: id as string };
		if (left.some((a) => right.some((b) => a.provider === b.provider)))
			throw new MetadataError({
				code: "invalid-request",
				message: "These works have conflicting source associations.",
				retryAt: null,
			});
		if (
			this.canAssociate &&
			!this.storage(() => this.canAssociate?.(target, other))
		)
			throw new MetadataError({
				code: "invalid-request",
				message:
					"Resolve duplicate local Catalog works before associating metadata.",
				retryAt: null,
			});
		this.storage(() => this.store.merge(target.id, other.id));
		this.logger?.info(
			{ event: "metadata.works_associated", workId: id, aliasId: otherId },
			"Verified metadata works associated; existing IDs remain resolvable.",
		);
		return { id: id as string };
	}
	private document<T>(
		kind: MetadataSnapshot["kind"],
		value: CachedMetadata<T>,
		artwork: ProjectDocument["artwork"] = {},
	): CachedMetadata<T> {
		// Self-contained, immutable project evidence survives source cache eviction and association changes.
		const id = `project:${createHash("sha256")
			.update(JSON.stringify([kind, value.snapshotId, value.data, artwork]))
			.digest("hex")}`;
		const result = { ...value, snapshotId: id };
		const sourceIds = value.snapshotId.split(":").filter(Boolean);
		const entries = sourceIds.flatMap((id) => {
			const entry = this.store.get(id);
			return entry ? [entry] : [];
		});
		const data: ProjectDocument = {
			sourceIds,
			project: { kind, ...result } as MetadataSnapshot,
			artwork,
		};
		this.storage(() =>
			this.store.save({
				id,
				key: id,
				kind,
				data,
				fetchedAt: value.fetchedAt,
				expiresAt: entries.length
					? Math.min(...entries.map((entry) => entry.expiresAt))
					: Date.now() + metadataDefaults.detailFreshMs,
				accessedAt: Date.now(),
				failure: null,
			}),
		);
		this.storage(() =>
			this.store.prune(metadataDefaults.searchKeys, metadataDefaults.snapshots),
		);
		return result;
	}
	private combined<T>(
		values: CachedMetadata<unknown>[],
		data: T,
		failed = false,
	): CachedMetadata<T> {
		const refreshFailure = values.find(
			(value) => value.refreshError,
		)?.refreshError;
		return {
			snapshotId: values.map((value) => value.snapshotId).join(":"),
			fetchedAt: values.length
				? Math.min(...values.map((value) => value.fetchedAt))
				: Date.now(),
			stale: failed || values.some((value) => value.stale),
			refreshing: values.some((value) => value.refreshing),
			refreshError: failed
				? {
						code: "unavailable",
						message: "Some work information is temporarily unavailable.",
						retryAt: null,
					}
				: refreshFailure
					? {
							...refreshFailure,
							message: "Metadata refresh failed. Retry shortly.",
						}
					: null,
			data,
		};
	}
	private async collect<T>(
		tasks: (() => Promise<T>)[],
		signal?: AbortSignal,
	): Promise<{ values: T[]; failed: boolean }> {
		const results = await Promise.allSettled(
			tasks.map((task) => Promise.resolve().then(task)),
		);
		signal?.throwIfAborted();
		const values = results.flatMap((result) =>
			result.status === "fulfilled" ? [result.value] : [],
		);
		if (!values.length && results.length) {
			const failure = results.find((result) => result.status === "rejected");
			if (failure?.status === "rejected") {
				const cause: unknown = failure.reason;
				if (cause instanceof MetadataError)
					throw new MetadataError(
						{
							...cause.failure,
							message: "Metadata could not be loaded. Retry shortly.",
						},
						{ cause },
					);
				throw cause;
			}
		}
		const failed = values.length !== results.length;
		if (failed)
			this.logger?.warn(
				{
					event: "metadata.partial_read",
					completed: values.length,
					attempted: results.length,
				},
				"Metadata retained available content after a partial failure.",
			);
		return { values, failed };
	}
	async search(request: SearchRequest, options: ReadOptions = {}) {
		const page = request.page ?? 1,
			perPage = request.perPage ?? 10;
		if (
			!Number.isSafeInteger(page) ||
			page < 1 ||
			!Number.isSafeInteger(perPage) ||
			perPage < 1 ||
			perPage > 50 ||
			page * perPage > 500
		)
			throw new MetadataError({
				code: "invalid-request",
				message:
					"Search supports a window of 500 results and pages of 1–50 items.",
				retryAt: null,
			});
		const limit = page * perPage;
		const { values, failed } = await this.collect(
			this.source.providers().map((provider) => async () => {
				const pages: CachedMetadata<Page<Source.WorkSummary>>[] = [];
				for (let index = 1; index <= Math.ceil(limit / 50); index++) {
					const result = await this.source.search(
						{
							query: request.query,
							provider: provider.key,
							page: index,
							perPage: 50,
						},
						options,
					);
					pages.push(result);
					if (!result.data.hasNextPage) break;
				}
				return this.combined(pages, {
					items: pages.flatMap((value) => value.data.items),
					hasNextPage: pages.at(-1)?.data.hasNextPage ?? false,
				});
			}),
			options.signal,
		);
		const unique = new Map<string, WorkSummary>();
		for (
			let i = 0;
			i < Math.max(0, ...values.map((value) => value.data.items.length));
			i++
		)
			for (const value of values) {
				const work = value.data.items[i];
				if (!work) continue;
				const projected = this.summary(work);
				if (!unique.has(projected.reference.id))
					unique.set(projected.reference.id, projected);
			}
		const items = [...unique.values()];
		this.logger?.debug(
			{
				event: "metadata.search_combined",
				sources: values.length,
				results: items.length,
				partial: failed,
			},
			"Project metadata search combined.",
		);
		return this.document(
			"search",
			this.combined(
				values,
				{
					items: items.slice((page - 1) * perPage, limit),
					page,
					perPage,
					hasNextPage:
						limit < 500 &&
						(items.length > limit ||
							values.some((value) => value.data.hasNextPage)),
				},
				failed,
			),
		);
	}
	private compose(
		values: CachedMetadata<Source.WorkDetails>[],
		failed = false,
	) {
		const first = values[0];
		if (!first)
			throw new MetadataError({
				code: "unavailable",
				message: "Work information is unavailable.",
				retryAt: null,
			});
		const data = this.details(first.data);
		const artwork: ProjectDocument["artwork"] = {};
		// Scalar conflicts keep the stable primary source; only missing fields are filled.
		for (const value of values) {
			const next = this.details(value.data);
			for (const key of Object.keys(data) as (keyof WorkDetails)[]) {
				if (
					key === "reference" ||
					key === "unavailableFields" ||
					key === "titles"
				)
					continue;
				if (
					data[key] === null ||
					(Array.isArray(data[key]) && !data[key].length)
				)
					Object.assign(data, { [key]: next[key] });
			}
			for (const kind of ["cover", "banner"] as const)
				if (
					!artwork[kind] &&
					value.data[kind === "cover" ? "coverUrl" : "bannerUrl"]
				)
					artwork[kind] = value.data;
		}
		data.titles = [
			...new Map(
				values
					.flatMap((value) => value.data.titles)
					.map((title) => [JSON.stringify(title), title]),
			).values(),
		];
		data.unavailableFields = [
			...new Set([
				...Object.entries(data)
					.filter(([, value]) => value === null)
					.map(([key]) => key),
				...values.flatMap((value) => value.data.unavailableFields),
			]),
		].filter((key) => {
			const value = data[key as keyof WorkDetails];
			return (
				value === null ||
				(Array.isArray(value) && !value.length) ||
				value === "unavailable"
			);
		});
		return this.document(
			"detail",
			this.combined(values, data, failed),
			artwork,
		);
	}
	async get(reference: WorkReference, options: ReadOptions = {}) {
		const { values, failed } = await this.read(() =>
			this.collect(
				this.references(reference).map(
					(ref) => () => this.source.get(ref, options),
				),
				options.signal,
			),
		);
		return this.compose(values, failed);
	}
	private async related(
		kind: "relations" | "airing",
		reference: WorkReference,
		page: number,
		perPage: number,
		options: ReadOptions,
	) {
		if (
			!Number.isSafeInteger(page) ||
			page < 1 ||
			!Number.isSafeInteger(perPage) ||
			perPage < 1 ||
			perPage > 25
		)
			throw new MetadataError({
				code: "invalid-request",
				message: "Invalid metadata pagination.",
				retryAt: null,
			});
		const capabilities = this.source.providers();
		const refs = this.references(reference).filter((ref) =>
			capabilities.some(
				(provider) => provider.key === ref.provider && provider[kind],
			),
		);
		if (kind === "relations") {
			if (!refs[0])
				return this.document(
					"relations",
					this.combined([], {
						unavailable: true,
						items: [] as WorkRelation[],
						page,
						perPage,
						hasNextPage: false,
					}),
				);
			const result = await this.source.relations(
				refs[0],
				page,
				perPage,
				options,
			);
			return this.document(
				"relations",
				this.envelope(result, (data) =>
					this.page(data, (item) => ({
						type: item.type,
						work: this.summary(item.work),
					})),
				),
			);
		}
		if (!refs[0])
			return this.document(
				"airing",
				this.combined([], {
					unavailable: true,
					items: [] as AiringEpisode[],
					page,
					perPage,
					hasNextPage: false,
				}),
			);
		const result = await this.source.airing(refs[0], page, perPage, options);
		return this.document(
			"airing",
			this.envelope(result, (data) =>
				this.page(data, (item) => ({ ...item, id: String(item.episode) })),
			),
		);
	}
	async relations(
		reference: WorkReference,
		page = 1,
		perPage = 25,
		options: ReadOptions = {},
	): Promise<CachedMetadata<Page<WorkRelation>>> {
		return (await this.read(() =>
			this.related("relations", reference, page, perPage, options),
		)) as CachedMetadata<Page<WorkRelation>>;
	}
	async airing(
		reference: WorkReference,
		page = 1,
		perPage = 25,
		options: ReadOptions = {},
	): Promise<CachedMetadata<Page<AiringEpisode>>> {
		return (await this.read(() =>
			this.related("airing", reference, page, perPage, options),
		)) as CachedMetadata<Page<AiringEpisode>>;
	}
	private legacySummary(work: Source.WorkSummary): WorkSummary {
		const data = this.summary(work);
		data.reference = {
			id: this.storage(() => this.store.originalIdentity(work.reference)),
		};
		if (data.coverUrl)
			data.coverUrl = `/api/metadata/${data.reference.id}/artwork/cover/image`;
		return data;
	}
	private legacyDetails(work: Source.WorkDetails): WorkDetails {
		const data = { ...this.details(work), ...this.legacySummary(work) };
		if (data.bannerUrl)
			data.bannerUrl = `/api/metadata/${data.reference.id}/artwork/banner/image`;
		return data;
	}
	/** Project retained evidence as well as live reads; provenance never crosses this boundary. */
	private project(snapshot: Source.MetadataSnapshot): MetadataSnapshot {
		switch (snapshot.kind) {
			case "search":
				return {
					kind: "search",
					...this.envelope(snapshot, (data) =>
						this.page(data, (item) => this.legacySummary(item)),
					),
				};
			case "detail":
				return {
					kind: "detail",
					...this.envelope(snapshot, (data) => this.legacyDetails(data)),
				};
			case "relations":
				return {
					kind: "relations",
					...this.envelope(snapshot, (data) =>
						this.page(data, (item) => ({
							type: item.type,
							work: this.legacySummary(item.work),
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
		const entry = this.storage(() => this.store.get(id));
		if (entry?.key.startsWith("project:")) {
			this.store.touch(id, Date.now());
			const document = entry.data as ProjectDocument;
			const states = document.sourceIds.flatMap((sourceId) =>
				this.store.get(sourceId) ? [this.source.snapshot(sourceId)] : [],
			);
			const failure = states.find((state) => state.refreshError)?.refreshError;
			return {
				...document.project,
				stale: document.project.stale || entry.expiresAt <= Date.now(),
				refreshing: states.some((state) => state.refreshing),
				refreshError: failure
					? { ...failure, message: "Metadata refresh failed. Retry shortly." }
					: document.project.refreshError,
			};
		}
		return this.project(this.source.snapshot(id));
	}
	current(reference: WorkReference) {
		const refs = this.references(reference);
		const values = refs.flatMap((ref) => {
			const value = this.source.current(ref);
			return value ? [value] : [];
		});
		return values.length
			? this.compose(values, values.length !== refs.length)
			: null;
	}
	retain(id: string, owner: string) {
		this.source.retain(id, owner);
	}
	release(id: string, owner: string) {
		this.source.release(id, owner);
	}
	async artwork(
		reference: WorkReference,
		kind: "cover" | "banner",
		options: ReadOptions = {},
	) {
		const details = await this.get(reference, options);
		return this.snapshotArtwork(details.snapshotId, kind, options);
	}
	async snapshotArtwork(
		id: string,
		kind: "cover" | "banner",
		options: ReadOptions = {},
	) {
		if (kind !== "cover" && kind !== "banner")
			throw new MetadataError({
				code: "invalid-request",
				message: "Unknown artwork kind.",
				retryAt: null,
			});
		const entry = this.storage(() => this.store.get(id));
		if (entry?.key.startsWith("project:")) {
			const document = entry.data as ProjectDocument;
			if (document.project.kind !== "detail")
				throw new MetadataError({
					code: "invalid-request",
					message: "Artwork requires a detail snapshot.",
					retryAt: null,
				});
			const data = document.artwork[kind];
			return data
				? this.source.artworkEvidence(data, kind, options)
				: { id: null, status: "missing" as const, failure: null };
		}
		return this.read(() => this.source.snapshotArtwork(id, kind));
	}
	readArtwork(id: string) {
		return this.source.readArtwork(id);
	}
	close() {
		return this.source.close();
	}
	private async cachedArtwork(
		reference: WorkReference,
		kind: "cover" | "banner",
	) {
		for (const ref of this.references(reference)) {
			const id = await this.source.cachedArtworkId(ref, kind);
			if (id) return id;
		}
		return null;
	}
	cachedArtworkId(reference: WorkReference, kind: "cover" | "banner") {
		return this.cachedArtwork(reference, kind);
	}
}
