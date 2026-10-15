import { Type } from "typebox";
export const ViewingStatusSchema = Type.Union([
	Type.Literal("CURRENT"),
	Type.Literal("PLANNING"),
	Type.Literal("COMPLETED"),
	Type.Literal("PAUSED"),
	Type.Literal("DROPPED"),
	Type.Literal("REPEATING"),
]);
export const ViewingStateSchema = Type.Object({
	status: ViewingStatusSchema,
	progress: Type.Integer({ minimum: 0 }),
	updatedAt: Type.Integer(),
});
const text = Type.Union([Type.String(), Type.Null()]);
export const TrackingListEnvelopeSchema = Type.Object({
	accountId: Type.Union([Type.Integer(), Type.Null()]),
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
	id: Type.Integer(),
	mediaId: Type.Integer(),
	progress: Type.Integer(),
	status: ViewingStatusSchema,
	updatedAt: Type.Integer(),
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
