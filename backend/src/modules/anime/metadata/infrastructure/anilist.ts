import { type Static, type TSchema, Type } from "typebox";
import { Check } from "typebox/value";
import {
	type AniListClient,
	AniListError,
	type AniListOptions,
	AniListScheduler,
} from "../../anilist/public.js";
import {
	MetadataError,
	type ProviderReference,
	type WorkDetails,
	type WorkSummary,
} from "../domain/model.js";
import type { MetadataProvider } from "../ports.js";

const nullable = <T extends TSchema>(type: T) =>
	Type.Union([type, Type.Null()]);
const text = nullable(Type.String());
const integer = nullable(Type.Integer({ minimum: 0 }));
const date = Type.Union([
	Type.Object({ year: integer, month: integer, day: integer }),
	Type.Null(),
]);
const summarySchema = Type.Object({
	id: Type.Integer({ minimum: 1, maximum: 2147483647 }),
	type: Type.Literal("ANIME"),
	title: Type.Object({ romaji: text, english: text, native: text }),
	synonyms: nullable(Type.Array(Type.String())),
	startDate: date,
	seasonYear: integer,
	format: text,
	status: text,
	episodes: integer,
	season: text,
	coverImage: Type.Union([
		Type.Object({ extraLarge: text, large: text }),
		Type.Null(),
	]),
});
const detailSchema = Type.Object({
	...summarySchema.properties,
	description: text,
	bannerImage: text,
	endDate: date,
	duration: integer,
	countryOfOrigin: text,
	source: text,
	genres: nullable(Type.Array(Type.String())),
	tags: nullable(
		Type.Array(
			Type.Object({
				name: Type.String(),
				rank: integer,
				isGeneralSpoiler: Type.Boolean(),
				isMediaSpoiler: Type.Boolean(),
			}),
		),
	),
	studios: nullable(
		Type.Object({
			nodes: Type.Array(
				Type.Object({ id: Type.Integer({ minimum: 1 }), name: Type.String() }),
			),
		}),
	),
	averageScore: integer,
	siteUrl: text,
	updatedAt: integer,
	streamingEpisodes: nullable(
		Type.Array(
			Type.Object({ title: text, url: text, site: text, thumbnail: text }),
		),
	),
});
const pageInfo = Type.Object({
	currentPage: Type.Integer({ minimum: 1 }),
	perPage: Type.Integer({ minimum: 1, maximum: 50 }),
	hasNextPage: Type.Boolean(),
});
const summaryFields = `id type title { romaji english native } synonyms startDate { year month day } seasonYear format status episodes season coverImage { extraLarge large }`;
const queries = {
	search: `query SearchAnime($query: String!, $page: Int!, $perPage: Int!) { Page(page: $page, perPage: $perPage) { pageInfo { currentPage perPage hasNextPage } media(search: $query, type: ANIME, sort: SEARCH_MATCH) { ${summaryFields} } } }`,
	detail: `query AnimeDetails($id: Int!) { Media(id: $id, type: ANIME) { ${summaryFields} description(asHtml: false) bannerImage endDate { year month day } duration countryOfOrigin source(version: 3) genres tags { name rank isGeneralSpoiler isMediaSpoiler } studios(isMain: true) { nodes { id name } } averageScore siteUrl updatedAt streamingEpisodes { title url site thumbnail } } }`,
	relations: `query AnimeRelations($id: Int!) { Media(id: $id, type: ANIME) { relations { edges { relationType(version: 2) node { ${summaryFields} } } } } }`,
	airing: `query AnimeAiring($id: Int!, $page: Int!, $perPage: Int!) { Media(id: $id, type: ANIME) { airingSchedule(page: $page, perPage: $perPage) { pageInfo { currentPage perPage hasNextPage } nodes { id episode airingAt } } } }`,
};
function invalid(): MetadataError {
	return new MetadataError({
		code: "invalid-response",
		message: "AniList returned an incomplete or invalid response.",
		retryAt: null,
	});
}
function summary(raw: Static<typeof summarySchema>): WorkSummary {
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
	return {
		unavailableFields: Object.entries(raw)
			.filter(([, value]) => value === null)
			.map(([key]) => key),
		reference: { provider: "anilist", mediaType: "anime", id: String(raw.id) },
		titles,
		year: raw.startDate?.year ?? raw.seasonYear,
		format: raw.format,
		status: raw.status,
		episodeCount: raw.episodes,
		airingSeason: raw.season,
		coverUrl: raw.coverImage?.extraLarge ?? raw.coverImage?.large ?? null,
	};
}
/** One shared instance in bootstrap; requests are paced and serialized conservatively. */
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
	private readonly client: AniListClient;
	constructor(options: AniListOptions & { client?: AniListClient } = {}) {
		this.client = options.client ?? new AniListScheduler(options);
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
	private async request(
		query: string,
		variables: Record<string, unknown>,
		signal: AbortSignal,
	): Promise<unknown> {
		try {
			return await this.client.request(query, variables, { signal });
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
	) {
		const raw = await this.request(
			queries.search,
			{ query, page, perPage },
			signal,
		);
		const schema = Type.Object({
			Page: Type.Object({
				pageInfo,
				media: Type.Array(summarySchema, { maxItems: 50 }),
			}),
		});
		if (!Check(schema, raw)) throw invalid();
		if (
			raw.Page.pageInfo.currentPage !== page ||
			raw.Page.pageInfo.perPage !== perPage ||
			raw.Page.media.length > perPage
		)
			throw invalid();
		return {
			raw,
			data: {
				items: raw.Page.media.map(summary),
				page,
				perPage,
				hasNextPage: raw.Page.pageInfo.hasNextPage,
			},
		};
	}
	async get(reference: ProviderReference, signal: AbortSignal) {
		const raw = await this.request(
			queries.detail,
			{ id: this.id(reference) },
			signal,
		);
		if (Check(Type.Object({ Media: Type.Null() }), raw))
			throw new MetadataError({
				code: "not-found",
				message: "Anime was not found on AniList.",
				retryAt: null,
			});
		if (
			!Check(Type.Object({ Media: detailSchema }), raw) ||
			String(raw.Media.id) !== reference.id
		)
			throw invalid();
		const media = raw.Media;
		const data: WorkDetails = {
			...summary(media),
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
		return { raw, data };
	}
	async relations(
		reference: ProviderReference,
		page: number,
		perPage: number,
		signal: AbortSignal,
	) {
		const raw = await this.request(
			queries.relations,
			{ id: this.id(reference) },
			signal,
		);
		// Relations may include manga; retain anime nodes only, without inventing cross-provider mappings.
		const relationSummary = Type.Object({
			...summarySchema.properties,
			type: Type.Union([Type.Literal("ANIME"), Type.Literal("MANGA")]),
		});
		const schema = Type.Object({
			Media: Type.Object({
				relations: Type.Object({
					edges: Type.Array(
						Type.Object({ relationType: Type.String(), node: relationSummary }),
						{ maxItems: 1000 },
					),
				}),
			}),
		});
		if (!Check(schema, raw)) throw invalid();
		const items = raw.Media.relations.edges
			.filter((edge) => edge.node.type === "ANIME")
			.map((edge) => ({
				type: edge.relationType,
				work: summary({ ...edge.node, type: "ANIME" }),
			}));
		return {
			raw,
			data: {
				items: items.slice((page - 1) * perPage, page * perPage),
				page,
				perPage,
				hasNextPage: items.length > page * perPage,
			},
		};
	}
	async airing(
		reference: ProviderReference,
		page: number,
		perPage: number,
		signal: AbortSignal,
	) {
		const raw = await this.request(
			queries.airing,
			{ id: this.id(reference), page, perPage },
			signal,
		);
		const schema = Type.Object({
			Media: Type.Object({
				airingSchedule: Type.Object({
					pageInfo,
					nodes: Type.Array(
						Type.Object({
							id: Type.Integer({ minimum: 1 }),
							episode: Type.Integer({ minimum: 1 }),
							airingAt: Type.Integer({ minimum: 0 }),
						}),
						{ maxItems: 50 },
					),
				}),
			}),
		});
		if (!Check(schema, raw)) throw invalid();
		const schedule = raw.Media.airingSchedule;
		if (
			schedule.pageInfo.currentPage !== page ||
			schedule.pageInfo.perPage !== perPage ||
			schedule.nodes.length > perPage
		)
			throw invalid();
		return {
			raw,
			data: {
				items: schedule.nodes.map((episode) => ({
					...episode,
					id: String(episode.id),
				})),
				page,
				perPage,
				hasNextPage: schedule.pageInfo.hasNextPage,
			},
		};
	}
}
