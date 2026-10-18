import { Type } from "typebox";
import { TrackingProviderSchema } from "./tracking-provider.js";
export const ViewingStatusSchema = Type.Union([
	Type.Literal("watching"),
	Type.Literal("planned"),
	Type.Literal("completed"),
	Type.Literal("paused"),
	Type.Literal("dropped"),
	Type.Literal("rewatching"),
]);
export const ViewingStateSchema = Type.Object({
	status: ViewingStatusSchema,
	progress: Type.Integer({ minimum: 0 }),
	updatedAt: Type.Union([Type.Integer(), Type.Null()]),
});
const text = Type.Union([Type.String(), Type.Null()]);
export const TrackingListEnvelopeSchema = Type.Object({
	provider: TrackingProviderSchema,
	accountId: Type.Union([Type.String(), Type.Null()]),
	generation: Type.String(),
	state: Type.Union([
		Type.Literal("disconnected"),
		Type.Literal("connected"),
		Type.Literal("authorization-required"),
	]),
	fetchedAt: Type.Union([Type.Integer(), Type.Null()]),
	stale: Type.Boolean(),
	refreshing: Type.Boolean(),
	error: Type.Union([
		Type.Object({
			code: Type.String(),
			retryAt: Type.Union([Type.Number(), Type.Null()]),
		}),
		Type.Null(),
	]),
});
const entry = Type.Object({
	id: Type.String({ minLength: 1 }),
	mediaId: Type.String({ minLength: 1 }),
	progress: Type.Integer(),
	status: ViewingStatusSchema,
	updatedAt: Type.Union([Type.Integer(), Type.Null()]),
	titles: Type.Array(Type.String()),
	format: text,
	year: Type.Union([Type.Integer(), Type.Null()]),
	episodeCount: Type.Union([Type.Integer(), Type.Null()]),
	coverUrl: text,
});
export const TrackingListSchema = Type.Object({
	...TrackingListEnvelopeSchema.properties,
	entries: Type.Array(entry),
});
export const TrackingEntrySchema = Type.Object({
	...TrackingListEnvelopeSchema.properties,
	entry: Type.Union([entry, Type.Null()]),
});
export const TrackingGenerationSchema = Type.Object(
	{ generation: Type.Optional(Type.String({ format: "uuid" })) },
	{ additionalProperties: false },
);
