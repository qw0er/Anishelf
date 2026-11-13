import { Type } from "typebox";
import { TrackingProviderSchema } from "./tracking-provider.ts";

const TrackingAccountSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	name: Type.String(),
});
export const TrackingStatusSchema = Type.Object({
	provider: TrackingProviderSchema,
	providers: Type.Optional(Type.Array(TrackingProviderSchema)),
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
	{
		credential: Type.String({ minLength: 1, maxLength: 8192 }),
		providerKey: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
	},
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
