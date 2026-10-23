import { Type } from "typebox";

export const QbittorrentConnectionSettingsSchema = Type.Object(
	{
		generation: Type.String(),
		state: Type.Union([
			Type.Literal("unconfigured"),
			Type.Literal("configured"),
			Type.Literal("unavailable"),
		]),
		url: Type.Union([Type.String(), Type.Null()]),
		username: Type.String(),
		passwordConfigured: Type.Boolean(),
		bundled: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
export const QbittorrentConnectionUpdateSchema = Type.Object(
	{
		generation: Type.String({ minLength: 1, maxLength: 64 }),
		url: Type.String({ minLength: 1, maxLength: 2048 }),
		username: Type.String({ minLength: 1, maxLength: 256 }),
		password: Type.Optional(Type.String({ maxLength: 4096 })),
	},
	{ additionalProperties: false },
);
export const QbittorrentConnectionCommandSchema = Type.Object(
	{
		generation: Type.String({ minLength: 1, maxLength: 64 }),
	},
	{ additionalProperties: false },
);
export const QbittorrentConnectionProbeSchema = Type.Object(
	{
		generation: Type.String(),
		available: Type.Boolean(),
		checkedAt: Type.Number(),
		version: Type.Union([Type.String(), Type.Null()]),
		code: Type.Union([Type.String(), Type.Null()]),
	},
	{ additionalProperties: false },
);
