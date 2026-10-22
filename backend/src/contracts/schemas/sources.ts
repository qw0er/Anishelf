import { Type } from "typebox";

const Generation = Type.String({ minLength: 1, maxLength: 64 });
const Indexer = Type.String({
	minLength: 1,
	maxLength: 80,
	pattern: "^[a-z0-9][a-z0-9-]*$",
});
const Origin = Type.Union([Type.Literal("bundled"), Type.Literal("external")]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
export const SourceSettingsSchema = Type.Object({
	generation: Generation,
	url: Type.Union([Type.String(), Type.Null()]),
	origin: Type.Union([Origin, Type.Null()]),
	indexers: Type.Array(Indexer),
	hasApiKey: Type.Boolean(),
	ready: Type.Boolean(),
	error: Type.Union([Type.String(), Type.Null()]),
});
export const SourceUpdateSchema = Type.Object(
	{
		generation: Generation,
		url: Type.String({ minLength: 1, maxLength: 2048 }),
		origin: Origin,
		apiKey: Type.Optional(
			Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
		),
		indexers: Type.Array(Indexer, { maxItems: 32, uniqueItems: true }),
	},
	{ additionalProperties: false },
);
export const SourceGenerationSchema = Type.Object(
	{ generation: Generation },
	{ additionalProperties: false },
);
export const SourceProbeInputSchema = Type.Object(
	{ generation: Generation, indexerId: Indexer },
	{ additionalProperties: false },
);
export const SourceSearchInputSchema = Type.Object(
	{
		generation: Generation,
		indexerId: Indexer,
		titles: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
			minItems: 1,
			maxItems: 4,
		}),
	},
	{ additionalProperties: false },
);
export const SourceIndexersSchema = Type.Array(
	Type.Object({ id: Indexer, name: Type.String() }),
);
export const SourceProbeSchema = Type.Object({
	generation: Generation,
	indexerId: Indexer,
	capabilities: Type.Object({ search: Type.Boolean(), limit: Type.Integer() }),
	searchVerified: Type.Literal(false),
});
export const SourceSearchSchema = Type.Object({
	source: Type.String(),
	outcome: Type.Union([Type.Literal("matches"), Type.Literal("no_match")]),
	coverage: Type.Object({
		limited: Type.Boolean(),
		reason: Type.Union([Type.String(), Type.Null()]),
		pages: Type.Integer(),
		queries: Type.Integer(),
	}),
	entries: Type.Array(
		Type.Object({
			id: Type.String(),
			title: Type.String(),
			publishedAt: NullableNumber,
			size: NullableNumber,
			seeders: NullableNumber,
			peers: NullableNumber,
			downloadAvailable: Type.Boolean(),
		}),
	),
});
