import {
	AniListError,
	type AniListMediaSummary,
	type AniListMetadataApi,
} from "../../anilist/public.js";
import {
	type AiringEpisode,
	MetadataError,
	type Page,
	type ProviderReference,
	type WorkDetails,
	type WorkRelation,
	type WorkSummary,
} from "../domain/source-model.js";
import type { MetadataProvider, ProviderResult } from "../ports.js";

function invalid(): MetadataError {
	return new MetadataError({
		code: "invalid-response",
		message: "AniList returned an incomplete or invalid response.",
		retryAt: null,
	});
}
function mediaTitles(raw: AniListMediaSummary): WorkSummary["titles"] {
	const titles: WorkSummary["titles"] = [];
	for (const [key, language] of [
		["romaji", null],
		["english", "en"],
		["native", null],
	] as const) {
		const value = raw.title[key];
		if (value) titles.push({ value, language, kind: key });
	}
	for (const value of raw.synonyms ?? [])
		if (value) titles.push({ value, language: null, kind: "alias" });
	if (!titles.length) throw invalid();
	return titles;
}
function summary(raw: AniListMediaSummary): WorkSummary {
	return {
		unavailableFields: Object.entries(raw)
			.filter(([, value]) => value === null)
			.map(([key]) => key),
		reference: { provider: "anilist", mediaType: "anime", id: String(raw.id) },
		titles: mediaTitles(raw),
		year: raw.startDate?.year ?? raw.seasonYear,
		format: raw.format,
		status: raw.status,
		episodeCount: raw.episodes,
		nextAiringEpisode: null,
		airingSeason: raw.season,
		coverUrl: raw.coverImage?.extraLarge ?? raw.coverImage?.large ?? null,
	};
}

/** Converts validated provider data into Metadata contracts; owns no GraphQL or transport. */
export class AniListProvider implements MetadataProvider {
	readonly capabilities = {
		key: "anilist",
		version: "anilist-v1",
		search: true,
		details: true,
		relations: true,
		airing: true,
		streamingLinks: true,
		canonicalEpisodes: false,
	} as const;
	constructor(private readonly client: AniListMetadataApi) {}
	resolveReference(value: string): ProviderReference | null {
		const match =
			/^(?:https:\/\/anilist\.co\/anime\/)?([1-9][0-9]*)(?:\/[^?#]*)?\/?$/.exec(
				value,
			);
		const id = match?.[1];
		return id && Number(id) <= 2147483647
			? { provider: "anilist", mediaType: "anime", id }
			: null;
	}
	private id(reference: ProviderReference): number {
		if (
			reference.provider !== "anilist" ||
			reference.mediaType !== "anime" ||
			!/^[1-9]\d*$/.test(reference.id) ||
			Number(reference.id) > 2147483647
		)
			throw new MetadataError({
				code: "invalid-request",
				message: "Invalid AniList anime reference.",
				retryAt: null,
			});
		return Number(reference.id);
	}

	private async read<T>(action: () => Promise<T>): Promise<T> {
		try {
			return await action();
		} catch (error) {
			if (error instanceof AniListError)
				throw new MetadataError({
					...error.failure,
					code:
						error.failure.code === "unauthorized"
							? "invalid-response"
							: error.failure.code,
				});
			throw error;
		}
	}
	async search(
		query: string,
		page: number,
		perPage: number,
		signal: AbortSignal,
	): Promise<ProviderResult<Page<WorkSummary>>> {
		const result = await this.read(() =>
			this.client.search(query, page, perPage, signal),
		);
		return {
			data: { ...result.data, items: result.data.items.map(summary) },
		};
	}
	async get(
		reference: ProviderReference,
		signal: AbortSignal,
	): Promise<ProviderResult<WorkDetails>> {
		const result = await this.read(() =>
			this.client.get(this.id(reference), signal),
		);
		const media = result.data;
		const data: WorkDetails = {
			...summary(media),
			nextAiringEpisode: media.nextAiringEpisode
				? {
						episode: media.nextAiringEpisode.episode,
						airingAt: media.nextAiringEpisode.airingAt,
					}
				: null,
			description: media.description,
			bannerUrl: media.bannerImage,
			startDate: media.startDate,
			endDate: media.endDate,
			durationMinutes: media.duration,
			country: media.countryOfOrigin,
			source: media.source,
			genres: media.genres ?? [],
			tags: (media.tags ?? []).map((tag) => ({
				name: tag.name,
				rank: tag.rank,
				spoiler: tag.isGeneralSpoiler || tag.isMediaSpoiler,
			})),
			studios: (media.studios?.nodes ?? []).map((studio) => ({
				id: String(studio.id),
				name: studio.name,
			})),
			averageScore: media.averageScore,
			siteUrl: media.siteUrl,
			providerUpdatedAt: media.updatedAt,
			streamingEpisodes: media.streamingEpisodes ?? [],
			episodeCatalog: "unavailable",
		};
		return { data };
	}
	async relations(
		reference: ProviderReference,
		page: number,
		perPage: number,
		signal: AbortSignal,
	): Promise<ProviderResult<Page<WorkRelation>>> {
		const result = await this.read(() =>
			this.client.relations(this.id(reference), signal),
		);
		const end = page * perPage;
		const items = result.data.slice(end - perPage, end).map(
			({ relationType: type, node }): WorkRelation =>
				node.type === "ANIME"
					? { type, work: summary(node) }
					: {
							type,
							external: {
								url: `https://anilist.co/manga/${node.id}`,
								titles: mediaTitles(node),
								format: node.format ?? "MANGA",
								year: node.startDate?.year ?? node.seasonYear,
							},
						},
		);
		return {
			data: {
				items,
				page,
				perPage,
				hasNextPage: result.data.length > end,
			},
		};
	}
	async airing(
		reference: ProviderReference,
		page: number,
		perPage: number,
		signal: AbortSignal,
	): Promise<ProviderResult<Page<AiringEpisode>>> {
		const result = await this.read(() =>
			this.client.airing(this.id(reference), page, perPage, signal),
		);
		return {
			data: {
				...result.data,
				items: result.data.items.map((episode) => ({
					...episode,
					id: String(episode.id),
				})),
			},
		};
	}
}
