import { Type } from "typebox";
import { Check } from "typebox/value";
import { type AniListClient, AniListError } from "../domain/model.js";
import type {
	AniListAiringEpisode,
	AniListMediaDetails,
	AniListMediaSummary,
	AniListMetadataApi,
	AniListPage,
	AniListRelation,
	AniListResult,
} from "../domain/provider.js";
import {
	detailSchema,
	pageInfo,
	queries,
	summarySchema,
	summarySelection,
} from "./media-schema.js";

function invalid(): never {
	throw new AniListError({
		code: "invalid-response",
		message: "AniList returned incomplete or invalid metadata.",
		retryAt: null,
	});
}
export class AniListMetadataClient implements AniListMetadataApi {
	constructor(private readonly client: AniListClient) {}
	async search(
		query: string,
		page: number,
		perPage: number,
		signal: AbortSignal,
	): Promise<AniListResult<AniListPage<AniListMediaSummary>>> {
		const result = await this.client.execute({ signal }, (sdk) =>
			sdk.anime.getAnimeBySearch(query, page, perPage, {
				select: {
					page: {
						pageInfo: { currentPage: true, perPage: true, hasNextPage: true },
						media: summarySelection,
					},
				},
			}),
		);
		const raw = { Page: result.page };
		const schema = Type.Object({
			Page: Type.Object({
				pageInfo,
				media: Type.Array(summarySchema, { maxItems: 50 }),
			}),
		});
		if (!Check(schema, raw)) invalid();
		if (
			raw.Page.pageInfo.currentPage !== page ||
			raw.Page.pageInfo.perPage !== perPage ||
			raw.Page.media.length > perPage
		)
			invalid();
		return {
			raw,
			data: {
				items: raw.Page.media,
				page,
				perPage,
				hasNextPage: raw.Page.pageInfo.hasNextPage,
			},
		};
	}
	async get(
		id: number,
		signal: AbortSignal,
	): Promise<AniListResult<AniListMediaDetails>> {
		const raw = await this.client.execute({ signal }, (sdk) =>
			sdk.graphql.request(queries.detail, { id }),
		);
		if (Check(Type.Object({ Media: Type.Null() }), raw))
			throw new AniListError({
				code: "not-found",
				message: "Anime was not found on AniList.",
				retryAt: null,
			});
		if (
			!Check(Type.Object({ Media: detailSchema }), raw) ||
			raw.Media.id !== id
		)
			invalid();
		return { raw, data: raw.Media };
	}
	async relations(
		id: number,
		signal: AbortSignal,
	): Promise<AniListResult<AniListRelation[]>> {
		const raw = await this.client.execute({ signal }, (sdk) =>
			sdk.graphql.request(queries.relations, { id }),
		);
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
		if (!Check(schema, raw)) invalid();
		return { raw, data: raw.Media.relations.edges };
	}
	async airing(
		id: number,
		page: number,
		perPage: number,
		signal: AbortSignal,
	): Promise<AniListResult<AniListPage<AniListAiringEpisode>>> {
		const raw = await this.client.execute({ signal }, (sdk) =>
			sdk.graphql.request(queries.airing, { id, page, perPage }),
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
		if (!Check(schema, raw)) invalid();
		const schedule = raw.Media.airingSchedule;
		if (
			schedule.pageInfo.currentPage !== page ||
			schedule.pageInfo.perPage !== perPage ||
			schedule.nodes.length > perPage
		)
			invalid();
		return {
			raw,
			data: {
				items: schedule.nodes,
				page,
				perPage,
				hasNextPage: schedule.pageInfo.hasNextPage,
			},
		};
	}
}
