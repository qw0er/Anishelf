import { Type } from "typebox";

const Generation = Type.String({ minLength: 1, maxLength: 64 });
const Provider = Type.String({
	minLength: 1,
	maxLength: 80,
	pattern: "^[a-z0-9][a-z0-9-]*$",
});
const Origin = Type.Union([Type.Literal("bundled"), Type.Literal("external")]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
export const SourceBundledInputSchema = Type.Object(
	{ generation: Generation, initializeSite: Type.Optional(Type.Boolean()) },
	{ additionalProperties: false },
);
export const SourceInputSchema = Type.Union([
	Type.Object(
		{
			kind: Type.Literal("feed"),
			url: Type.String({ minLength: 1, maxLength: 4096 }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			kind: Type.Literal("search"),
			connectionRevision: Generation,
			providerId: Provider,
			titles: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
				minItems: 1,
				maxItems: 4,
			}),
		},
		{ additionalProperties: false },
	),
]);
export const SourceTestInputSchema = Type.Union([
	SourceInputSchema,
	Type.Object(
		{ sourceId: Type.String({ minLength: 1, maxLength: 128 }) },
		{ additionalProperties: false },
	),
]);
export const SourceSettingsSchema = Type.Object({
	bundledAvailable: Type.Optional(Type.Boolean()),
	bundledSetup: Type.Optional(
		Type.Union([
			Type.Literal("waiting"),
			Type.Literal("pending"),
			Type.Literal("complete"),
			Type.Literal("manual"),
		]),
	),
	managementUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	generation: Generation,
	url: Type.Union([Type.String(), Type.Null()]),
	origin: Type.Union([Origin, Type.Null()]),
	providers: Type.Array(Provider),
	hasApiKey: Type.Boolean(),
	ready: Type.Boolean(),
	error: Type.Union([Type.String(), Type.Null()]),
});
export const SourceUpdateSchema = Type.Object(
	{
		managementUrl: Type.Optional(
			Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
		),
		generation: Generation,
		url: Type.String({ minLength: 1, maxLength: 2048 }),
		origin: Origin,
		apiKey: Type.Optional(
			Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
		),
		providers: Type.Array(Provider, { maxItems: 32, uniqueItems: true }),
	},
	{ additionalProperties: false },
);
export const SourceGenerationSchema = Type.Object(
	{ generation: Generation },
	{ additionalProperties: false },
);
export const SourceProbeInputSchema = Type.Object(
	{ generation: Generation, providerId: Provider },
	{ additionalProperties: false },
);
export const SourceProvidersSchema = Type.Array(
	Type.Object({ id: Provider, name: Type.String() }),
);
export const SourceProbeSchema = Type.Object({
	generation: Generation,
	providerId: Provider,
	searchSupported: Type.Boolean(),
	searchVerified: Type.Literal(false),
});
const Coverage = Type.Object({
	limited: Type.Boolean(),
	reason: Type.Union([Type.String(), Type.Null()]),
	pages: Type.Integer(),
	queries: Type.Integer(),
});
export const SourceTestSchema = Type.Object({
	source: Type.String(),
	outcome: Type.Union([Type.Literal("matches"), Type.Literal("no_match")]),
	coverage: Type.Optional(Coverage),
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
