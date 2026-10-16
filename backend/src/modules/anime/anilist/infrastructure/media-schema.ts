import { type TSchema, Type } from "typebox";

const nullable = <T extends TSchema>(type: T) =>
	Type.Union([type, Type.Null()]);
const text = nullable(Type.String());
const integer = nullable(Type.Integer({ minimum: 0 }));
const date = Type.Union([
	Type.Object({ year: integer, month: integer, day: integer }),
	Type.Null(),
]);
export const summarySchema = Type.Object({
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
export const detailSchema = Type.Object({
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
export const pageInfo = Type.Object({
	currentPage: Type.Integer({ minimum: 1 }),
	perPage: Type.Integer({ minimum: 1, maximum: 50 }),
	hasNextPage: Type.Boolean(),
});
const summaryFields = `id type title { romaji english native } synonyms startDate { year month day } seasonYear format status episodes season coverImage { extraLarge large }`;
export const queries = {
	search: `query SearchAnime($query: String!, $page: Int!, $perPage: Int!) { Page(page: $page, perPage: $perPage) { pageInfo { currentPage perPage hasNextPage } media(search: $query, type: ANIME, sort: SEARCH_MATCH) { ${summaryFields} } } }`,
	detail: `query AnimeDetails($id: Int!) { Media(id: $id, type: ANIME) { ${summaryFields} description(asHtml: false) bannerImage endDate { year month day } duration countryOfOrigin source(version: 3) genres tags { name rank isGeneralSpoiler isMediaSpoiler } studios(isMain: true) { nodes { id name } } averageScore siteUrl updatedAt streamingEpisodes { title url site thumbnail } } }`,
	relations: `query AnimeRelations($id: Int!) { Media(id: $id, type: ANIME) { relations { edges { relationType(version: 2) node { ${summaryFields} } } } } }`,
	airing: `query AnimeAiring($id: Int!, $page: Int!, $perPage: Int!) { Media(id: $id, type: ANIME) { airingSchedule(page: $page, perPage: $perPage) { pageInfo { currentPage perPage hasNextPage } nodes { id episode airingAt } } } }`,
};
