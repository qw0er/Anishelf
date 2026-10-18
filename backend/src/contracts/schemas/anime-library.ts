import { Type } from "typebox";
import { CatalogListQuerySchema } from "./anime-catalog.js";
import {
	TrackingListEnvelopeSchema,
	ViewingStateSchema,
	ViewingStatusSchema,
} from "./tracking-list.js";

const text = Type.Union([Type.String(), Type.Null()]);
const integer = Type.Union([Type.Integer(), Type.Null()]);
export const AnimeLibraryQuerySchema = Type.Object(
	{
		...CatalogListQuerySchema.properties,
		scope: Type.Optional(
			Type.Union([Type.Literal("local"), Type.Literal("all")]),
		),
		viewingStatus: Type.Optional(
			Type.Union([ViewingStatusSchema, Type.Literal("untracked")]),
		),
		generation: Type.Optional(Type.String({ format: "uuid" })),
	},
	{ additionalProperties: false },
);
export const AnimeLibrarySchema = Type.Object({
	items: Type.Array(
		Type.Object({
			id: Type.String(),
			localWorkId: text,
			reference: Type.Object({
				provider: Type.String(),
				mediaType: Type.Literal("anime"),
				id: Type.String(),
			}),
			displayTitle: Type.String(),
			format: text,
			year: integer,
			episodeCount: integer,
			updatedAt: Type.Integer(),
			availableEpisodes: Type.Integer(),
			availableUnwatchedEpisodes: Type.Optional(integer),
			availableRegularEpisodes: Type.Integer(),
			metadataStale: Type.Boolean(),
			coverUrl: text,
			viewingAvailability: Type.Union([
				Type.Literal("unknown"),
				Type.Literal("unmapped"),
				Type.Literal("tracked"),
				Type.Literal("untracked"),
			]),
			viewing: Type.Union([ViewingStateSchema, Type.Null()]),
		}),
	),
	page: Type.Integer(),
	perPage: Type.Integer(),
	hasNextPage: Type.Boolean(),
	localState: Type.Union([
		Type.Literal("available"),
		Type.Literal("unavailable"),
	]),
	tracking: TrackingListEnvelopeSchema,
});
