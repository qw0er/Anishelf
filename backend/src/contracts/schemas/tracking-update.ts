import { Type } from "typebox";
import { ViewingStatusSchema } from "./tracking-list.js";

const TrackingRemoteSchema = Type.Union([
	Type.Object(
		{
			id: Type.Integer({ minimum: 1 }),
			progress: Type.Integer({ minimum: 0, maximum: 2147483647 }),
			status: ViewingStatusSchema,
			updatedAt: Type.Integer({ minimum: 0 }),
		},
		{ additionalProperties: false },
	),
	Type.Null(),
]);
const desired = Type.Object(
	{
		progress: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647 })),
		status: Type.Optional(ViewingStatusSchema),
	},
	{ additionalProperties: false, minProperties: 1 },
);
export const TrackingUpdateSchema = Type.Object(
	{
		commandId: Type.String({ format: "uuid" }),
		generation: Type.String({ format: "uuid" }),
		revision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
		baseline: TrackingRemoteSchema,
		desired,
	},
	{ additionalProperties: false },
);
export const TrackingOperationCommandSchema = Type.Object(
	{
		generation: Type.String({ format: "uuid" }),
		revision: Type.Integer({ minimum: 1 }),
	},
	{ additionalProperties: false },
);
export const TrackingResolveSchema = Type.Object(
	{ ...TrackingOperationCommandSchema.properties, keepRemote: Type.Boolean() },
	{ additionalProperties: false },
);
export const TrackingEpisodeTargetSchema = Type.Object({
	fileId: Type.String(),
	sourceVersion: Type.String(),
	reviewId: Type.String(),
	mappingRevision: Type.Integer(),
	episodeId: Type.String(),
	mediaId: Type.Integer({ minimum: 1 }),
	episode: Type.Integer({ minimum: 1 }),
});
export const TrackingEpisodeCommandSchema = Type.Object(
	{
		mappingRevision: Type.Integer({ minimum: 1 }),
		commandId: Type.String({ format: "uuid" }),
		generation: Type.String({ format: "uuid" }),
		revision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
		fileId: Type.String({ minLength: 1 }),
		sourceVersion: Type.String({ minLength: 1 }),
		action: Type.Union([Type.Literal("mark"), Type.Literal("keep")]),
		confirmSkipped: Type.Optional(Type.Boolean()),
		initialStatus: Type.Optional(ViewingStatusSchema),
	},
	{ additionalProperties: false },
);
export const TrackingOperationSchema = Type.Object({
	origin: Type.Union([
		Type.Literal("manual-detail"),
		Type.Literal("manual-player"),
		Type.Literal("automatic"),
	]),
	commandId: Type.String(),
	intentAt: Type.Number(),
	decisionReason: Type.Union([
		Type.Null(),
		Type.Literal("skipped-episodes"),
		Type.Literal("initial-status-required"),
	]),
	target: Type.Union([Type.Null(), TrackingEpisodeTargetSchema]),
	id: Type.String(),
	accountId: Type.Integer(),
	mediaId: Type.Integer(),
	revision: Type.Integer(),
	baseline: TrackingRemoteSchema,
	desired,
	state: Type.Union([
		Type.Literal("decision-required"),
		Type.Literal("pending"),
		Type.Literal("submitting"),
		Type.Literal("failed"),
		Type.Literal("conflict"),
		Type.Literal("authorization-required"),
		Type.Literal("succeeded"),
		Type.Literal("cancelled"),
	]),
	remote: TrackingRemoteSchema,
	attempts: Type.Integer(),
	retryAt: Type.Union([Type.Number(), Type.Null()]),
	error: Type.Union([Type.String(), Type.Null()]),
	updatedAt: Type.Number(),
});
export const TrackingOperationsSchema = Type.Array(TrackingOperationSchema);
