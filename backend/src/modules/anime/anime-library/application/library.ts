import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import {
	workKey,
	workReference,
} from "../../../../shared/external-reference.js";
import type { AnimeCatalogApi, WorkCard } from "../../anime-catalog/public.js";
import type {
	TrackingListEntry,
	TrackingListsApi,
} from "../../tracking/public.js";
import type {
	AnimeLibraryQuery,
	LibraryCard,
	LibraryResult,
	LocalIndex,
} from "../domain/model.js";
import type { AnimeLibraryApi } from "../public.js";
/** A read projection: joins stable provider IDs; never creates Catalog works. */
export class AnimeLibraryQueries implements AnimeLibraryApi {
	constructor(
		private readonly options: {
			catalog: Pick<AnimeCatalogApi, "index" | "cards"> | undefined;
			lists: TrackingListsApi;
			logger: Logger;
		},
	) {}
	async list(
		query: AnimeLibraryQuery = {},
		generation?: string,
	): Promise<LibraryResult> {
		const page = query.page ?? 1;
		const perPage = query.perPage ?? 24;
		if (
			!Number.isSafeInteger(page) ||
			page < 1 ||
			page > 100000 ||
			!Number.isSafeInteger(perPage) ||
			perPage < 1 ||
			perPage > 50
		)
			throw new DomainError("INVALID_REQUEST", "Invalid library page.");
		const tracking = this.options.lists.list(generation);
		const index = await this.localIndex();
		this.options.lists.list(tracking.generation, false);
		const tracked = new Map(
			tracking.entries.map((entry) => [entry.mediaId, entry]),
		);
		const sort = query.sort ?? "unwatched";
		const addedAt = new Map<string, number>();
		const cards = new Map<string, LibraryCard>();
		const localKeys = new Set(
			index?.items.map((work) => workKey(work.reference)) ?? [],
		);
		for (const work of index?.items ?? []) {
			const viewing = tracked.get(workKey(work.reference));
			const key = workKey(work.reference);
			if (
				(query.availability === "available" && !work.available) ||
				(query.availability === "unavailable" && work.available) ||
				(query.format && query.format !== work.format) ||
				(query.year !== undefined && query.year !== work.year) ||
				(query.query &&
					![
						work.providerTitle,
						...work.searchTitles,
						...(viewing?.titles ?? []),
					].some((title) =>
						title
							.toLocaleLowerCase("en")
							.includes(query.query?.toLocaleLowerCase("en") ?? ""),
					))
			)
				continue;
			addedAt.set(work.id, work.createdAt);
			cards.set(key, {
				id: work.id,
				localWorkId: work.id,
				reference: work.reference,
				displayTitle: work.providerTitle,
				format: work.format,
				year: work.year,
				episodeCount: work.episodeCount,
				airedEpisodeCount: work.airedEpisodeCount,
				updatedAt: work.updatedAt,
				availableEpisodes: 0,
				availableRegularEpisodes: 0,
				metadataStale: false,
				hasCover: false,
				remoteCoverUrl: null,
				viewing: viewing ? viewingState(viewing) : null,
				viewingAvailability:
					work.reference.provider !== tracking.provider.key
						? "unmapped"
						: tracking.fetchedAt === null
							? "unknown"
							: viewing
								? "tracked"
								: "untracked",
			});
		}
		if (query.scope === "all" && query.availability !== "available")
			for (const entry of tracking.entries) {
				const key = entry.mediaId;
				if (localKeys.has(key) || !matches(entry, query)) continue;
				addedAt.set(entry.mediaId, entry.updatedAt ?? tracking.fetchedAt ?? 0);
				cards.set(key, {
					id: entry.mediaId,
					localWorkId: null,
					reference: workReference(entry.mediaId),
					displayTitle: entry.titles[0] ?? String(entry.mediaId),
					format: entry.format,
					year: entry.year,
					episodeCount: entry.episodeCount,
					airedEpisodeCount: null,
					updatedAt: entry.updatedAt ?? tracking.fetchedAt ?? 0,
					availableEpisodes: 0,
					availableRegularEpisodes: 0,
					metadataStale: tracking.stale,
					hasCover: false,
					remoteCoverUrl: entry.coverUrl,
					viewing: viewingState(entry),
					viewingAvailability: "tracked",
				});
			}
		let filtered = [...cards.values()].filter(
			(card) =>
				!query.viewingStatus ||
				(query.viewingStatus === "untracked"
					? card.viewingAvailability === "untracked"
					: card.viewing?.status === query.viewingStatus),
		);
		const hydrated =
			sort === "unwatched"
				? await this.hydrate(
						filtered.filter((card) => card.localWorkId && card.viewing),
						index,
					)
				: new Map<string, WorkCard>();
		if (sort === "unwatched")
			filtered = filtered.map((card) => localCard(card, hydrated.get(card.id)));
		filtered.sort((a, b) => {
			if (sort === "recent")
				return (
					(addedAt.get(b.id) ?? 0) - (addedAt.get(a.id) ?? 0) ||
					a.id.localeCompare(b.id)
				);
			if (sort === "updated")
				return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
			const priority =
				sort === "unwatched"
					? Number((b.availableUnwatchedEpisodes ?? 0) > 0) -
						Number((a.availableUnwatchedEpisodes ?? 0) > 0)
					: 0;
			return (
				priority ||
				a.displayTitle.localeCompare(b.displayTitle, "en", {
					sensitivity: "base",
					numeric: true,
				}) ||
				a.id.localeCompare(b.id)
			);
		});

		const selected = filtered.slice((page - 1) * perPage, page * perPage);
		const localIds = selected.flatMap((card) =>
			card.localWorkId ? [card.localWorkId] : [],
		);
		for (const [id, card] of await this.hydrate(
			selected.filter(
				(card) => card.localWorkId && !hydrated.has(card.localWorkId),
			),
			index,
		))
			hydrated.set(id, card);
		const items = selected.map((card) =>
			localCard(
				card,
				card.localWorkId ? hydrated.get(card.localWorkId) : undefined,
			),
		);
		this.options.lists.list(tracking.generation, false);
		const { entries: _, ...envelope } = tracking;
		this.options.logger.trace(
			{
				event: "anime.library_read",
				scope: query.scope ?? "local",
				sort,
				count: items.length,
				totalCount: filtered.length,
				localCount: localIds.length,
				remoteCount: items.length - localIds.length,
				trackingState: tracking.state,
				localState: index ? "available" : "unavailable",
			},
			"Anime library projection read.",
		);
		return {
			items,
			page,
			perPage,
			hasNextPage: filtered.length > page * perPage,
			localState: index ? "available" : "unavailable",
			tracking: envelope,
		};
	}
	private async hydrate(
		cards: readonly LibraryCard[],
		index: LocalIndex | null,
	) {
		const hydrated = new Map<string, WorkCard>();
		if (!this.options.catalog || !index) return hydrated;
		const ids = cards.flatMap((card) =>
			card.localWorkId ? [card.localWorkId] : [],
		);
		for (let offset = 0; offset < ids.length; offset += 50)
			for (const card of await this.options.catalog.cards(
				ids.slice(offset, offset + 50),
				index.epoch,
			))
				hydrated.set(card.id, card);
		return hydrated;
	}

	private async localIndex(): Promise<LocalIndex | null> {
		if (!this.options.catalog) return null;
		try {
			return await this.options.catalog.index();
		} catch (error) {
			if (
				error instanceof DomainError &&
				[
					"RESOURCE_ROOT_NOT_CONFIGURED",
					"RESOURCE_ROOT_UNAVAILABLE",
					"CATALOG_UNAVAILABLE",
				].includes(error.code)
			)
				return null;
			throw error;
		}
	}
}
function viewingState(entry: TrackingListEntry) {
	return {
		status: entry.status,
		progress: entry.progress,
		updatedAt: entry.updatedAt,
	};
}
function matches(entry: TrackingListEntry, query: AnimeLibraryQuery) {
	return (
		(!query.query ||
			entry.titles.some((title) =>
				title
					.toLocaleLowerCase("en")
					.includes(query.query?.toLocaleLowerCase("en") ?? ""),
			)) &&
		(!query.format || entry.format === query.format) &&
		(query.year === undefined || entry.year === query.year)
	);
}
function localCard(card: LibraryCard, work: WorkCard | undefined): LibraryCard {
	return work
		? {
				...card,
				availableEpisodes: work.availableEpisodes,
				availableUnwatchedEpisodes:
					card.viewing && work.availableTrackingEpisodes
						? work.availableTrackingEpisodes.filter(
								(number) => number > (card.viewing?.progress ?? 0),
							).length
						: null,
				availableRegularEpisodes: work.availableRegularEpisodes,
				hasCover: work.hasCover,
				metadataStale: work.metadataStale,
			}
		: card;
}
