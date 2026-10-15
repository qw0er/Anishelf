import { Type } from "typebox";

const TrackingAccountSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
	name: Type.String(),
});
export const TrackingStatusSchema = Type.Object({
	clientId: Type.String(),
	authorizationUrl: Type.String(),
	generation: Type.String(),
	account: Type.Union([TrackingAccountSchema, Type.Null()]),
	state: Type.Union([
		Type.Literal("disconnected"),
		Type.Literal("connected"),
		Type.Literal("authorization-required"),
	]),
	connectivity: Type.Union([
		Type.Literal("unknown"),
		Type.Literal("available"),
		Type.Literal("unavailable"),
	]),
	checkedAt: Type.Union([Type.Number(), Type.Null()]),
});
export const TrackingPreviewRequestSchema = Type.Object(
	{ token: Type.String({ minLength: 1, maxLength: 8192, pattern: "^\\S+$" }) },
	{ additionalProperties: false },
);
export const TrackingPreviewSchema = Type.Object({
	candidateId: Type.String(),
	account: TrackingAccountSchema,
	expiresAt: Type.Number(),
	generation: Type.String(),
});
export const TrackingConfirmSchema = Type.Object(
	{
		candidateId: Type.String({ format: "uuid" }),
		generation: Type.String({ format: "uuid" }),
	},
	{ additionalProperties: false },
);
export const TrackingDisconnectSchema = Type.Object(
	{ generation: Type.String({ format: "uuid" }) },
	{ additionalProperties: false },
);
