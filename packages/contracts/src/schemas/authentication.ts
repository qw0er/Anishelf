import { Type } from "typebox";
export const LoginRequestSchema = Type.Object(
	{ password: Type.String({ minLength: 1, maxLength: 128 }) },
	{ additionalProperties: false },
);
export const ChangePasswordRequestSchema = Type.Object(
	{
		currentPassword: Type.String({ minLength: 1, maxLength: 128 }),
		password: Type.String({ minLength: 8, maxLength: 128 }),
	},
	{ additionalProperties: false },
);
export const AuthSessionResponseSchema = Type.Object(
	{ authenticated: Type.Boolean(), csrfToken: Type.String() },
	{ additionalProperties: false },
);
export const DeviceSessionIdSchema = Type.String({
	pattern:
		"^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$",
});
export const DeviceLoginRequestSchema = Type.Object(
	{
		password: LoginRequestSchema.properties.password,
		name: Type.String({ minLength: 1, maxLength: 80 }),
	},
	{ additionalProperties: false },
);
export const DeviceSessionSchema = Type.Object(
	{
		id: DeviceSessionIdSchema,
		name: Type.String(),
		createdAt: Type.Integer(),
		expiresAt: Type.Integer(),
	},
	{ additionalProperties: false },
);
export const DeviceLoginResponseSchema = Type.Object(
	{ token: Type.String(), session: DeviceSessionSchema },
	{ additionalProperties: false },
);
export const MediaAccessLinkResponseSchema = Type.Object(
	{ url: Type.String(), expiresAt: Type.Integer() },
	{ additionalProperties: false },
);
