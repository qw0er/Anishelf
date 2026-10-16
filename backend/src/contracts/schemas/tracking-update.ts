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
export const TrackingOperationSchema = Type.Object({
	id: Type.String(),
	accountId: Type.Integer(),
	mediaId: Type.Integer(),
	revision: Type.Integer(),
	baseline: TrackingRemoteSchema,
	desired,
	state: Type.Union([
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
