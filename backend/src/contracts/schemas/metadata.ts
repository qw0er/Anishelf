import { Type } from "typebox";

const text = Type.Union([Type.String(), Type.Null()]);
const integer = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);
export const MetadataReferenceSchema = Type.Object({
	provider: Type.String(),
	mediaType: Type.Literal("anime"),
	id: Type.String(),
});
const summary = {
	unavailableFields: Type.Array(Type.String()),
	reference: MetadataReferenceSchema,
	titles: Type.Array(
		Type.Object({
			value: Type.String(),
			language: text,
			kind: Type.Union([
				Type.Literal("romaji"),
				Type.Literal("english"),
				Type.Literal("native"),
				Type.Literal("alias"),
			]),
		}),
	),
	year: integer,
	format: text,
	status: text,
	episodeCount: integer,
	nextAiringEpisode: Type.Optional(
		Type.Union([
			Type.Object({
				episode: Type.Integer({ minimum: 1 }),
				airingAt: Type.Integer({ minimum: 0 }),
			}),
			Type.Null(),
		]),
	),
	airingSeason: text,
	coverUrl: text,
};
const date = Type.Union([
	Type.Object({ year: integer, month: integer, day: integer }),
	Type.Null(),
]);
const failure = Type.Object({
	code: Type.String(),
	message: Type.String(),
	retryAt: integer,
});
const envelope = <T extends ReturnType<typeof Type.Object>>(data: T) =>
	Type.Object({
		snapshotId: Type.String(),
		fetchedAt: Type.Integer(),
		stale: Type.Boolean(),
		refreshing: Type.Boolean(),
		refreshError: Type.Union([failure, Type.Null()]),
		data,
	});
const page = <T extends ReturnType<typeof Type.Object>>(item: T) =>
	Type.Object({
		items: Type.Array(item),
		page: Type.Integer(),
		perPage: Type.Integer(),
		hasNextPage: Type.Boolean(),
	});
export const MetadataSearchResponseSchema = envelope(
	page(Type.Object(summary)),
);
export const MetadataDetailsResponseSchema = envelope(
	Type.Object({
		...summary,
		description: text,
		bannerUrl: text,
		startDate: date,
		endDate: date,
		durationMinutes: integer,
		country: text,
		source: text,
		genres: Type.Array(Type.String()),
		tags: Type.Array(
			Type.Object({
				name: Type.String(),
				rank: integer,
				spoiler: Type.Boolean(),
			}),
		),
		studios: Type.Array(
			Type.Object({ id: Type.String(), name: Type.String() }),
		),
		averageScore: integer,
		siteUrl: text,
		providerUpdatedAt: integer,
		streamingEpisodes: Type.Array(
			Type.Object({ title: text, url: text, site: text, thumbnail: text }),
		),
		episodeCatalog: Type.Literal("unavailable"),
	}),
);
export const MetadataRelationsResponseSchema = envelope(
	page(Type.Object({ type: Type.String(), work: Type.Object(summary) })),
);
export const MetadataAiringResponseSchema = envelope(
	page(
		Type.Object({
			id: Type.String(),
			episode: Type.Integer(),
			airingAt: Type.Integer(),
		}),
	),
);
export const MetadataArtworkResponseSchema = Type.Object({
	id: text,
	status: Type.Union([
		Type.Literal("ready"),
		Type.Literal("missing"),
		Type.Literal("failed"),
	]),
	failure: Type.Union([failure, Type.Null()]),
});
export const MetadataReferenceParamsSchema = Type.Object(
	{
		provider: Type.String({ minLength: 1, maxLength: 50 }),
		id: Type.String({ minLength: 1, maxLength: 200 }),
	},
	{ additionalProperties: false },
);
export const MetadataReadQuerySchema = Type.Object(
	{
		cachedOnly: Type.Optional(
			Type.Union([Type.Literal("true"), Type.Literal("false")]),
		),
	},
	{ additionalProperties: false },
);
export const MetadataPageQuerySchema = Type.Object(
	{
		...MetadataReadQuerySchema.properties,
		page: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,3}$" })),
		perPage: Type.Optional(Type.String({ pattern: "^[1-9][0-9]?$" })),
	},
	{ additionalProperties: false },
);
export const MetadataSearchQuerySchema = Type.Object(
	{
		...MetadataPageQuerySchema.properties,
		query: Type.String({ minLength: 1, maxLength: 200 }),
		provider: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
	},
	{ additionalProperties: false },
);
