import { Type } from "typebox";
import { errorCodes } from "../errors.js";

export const EmptyObjectSchema = Type.Object(
	{},
	{ additionalProperties: false },
);
export const ResourceIdSchema = Type.String({
	minLength: 1,
	maxLength: 64,
	pattern: "^[A-Za-z0-9_-]+$",
});
export const ResourceParamsSchema = Type.Object(
	{ id: ResourceIdSchema },
	{ additionalProperties: false },
);
export const NonnegativeIntegerSchema = Type.Integer({
	minimum: 0,
	maximum: Number.MAX_SAFE_INTEGER,
});
export const PositiveIntegerSchema = Type.Integer({
	minimum: 1,
	maximum: Number.MAX_SAFE_INTEGER,
});
export const HealthResponseSchema = Type.Object(
	{ status: Type.Literal("ok") },
	{ additionalProperties: false },
);
export const ApiErrorResponseSchema = Type.Object(
	{
		error: Type.Object(
			{
				code: Type.Enum(errorCodes),
				message: Type.String(),
				requestId: Type.String(),
			},
			{ additionalProperties: false },
		),
	},
	{ additionalProperties: false },
);
