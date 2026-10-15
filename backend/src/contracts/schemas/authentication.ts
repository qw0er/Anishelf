import { Type } from "typebox";
export const LoginRequestSchema = Type.Object(
	{ password: Type.String({ minLength: 1, maxLength: 128 }) },
	{ additionalProperties: false },
);
export const ChangePasswordRequestSchema = Type.Object(
	{
		currentPassword: Type.String({ minLength: 1, maxLength: 128 }),
		password: Type.String({ minLength: 12, maxLength: 128 }),
	},
	{ additionalProperties: false },
);
export const AuthSessionResponseSchema = Type.Object(
	{ authenticated: Type.Boolean(), csrfToken: Type.String() },
	{ additionalProperties: false },
);
export const MediaAccessLinkResponseSchema = Type.Object(
	{ url: Type.String(), expiresAt: Type.Integer() },
	{ additionalProperties: false },
);
