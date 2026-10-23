import { Type } from "typebox";

const revision = Type.String({ minLength: 1, maxLength: 64 });
const key = Type.String({ minLength: 1, maxLength: 1024 });
const nullableString = Type.Union([Type.String(), Type.Null()]);
const WatchingConfigSchema = Type.Object(
	{
		backlog: Type.Union([Type.Literal("progress"), Type.Literal("beginning")]),
		profileId: Type.String({
			pattern: "^(builtin|custom):[a-z][a-z0-9-]{0,63}$",
		}),
	},
	{ additionalProperties: false },
);
export const WatchingStatusSchema = Type.Object({
	revision,
	enabled: Type.Boolean(),
	reason: Type.String(),
	accountId: nullableString,
	trackingGeneration: Type.String(),
	config: Type.Union([WatchingConfigSchema, Type.Null()]),
	works: Type.Array(
		Type.Object({
			workKey: key,
			title: Type.String(),
			revision: Type.Union([revision, Type.Null()]),
			managed: Type.Boolean(),
			excluded: Type.Boolean(),
			paused: Type.Boolean(),
			startEpisode: Type.Union([Type.Integer(), Type.Null()]),
			reason: Type.String(),
		}),
	),
});
export const WatchingPreviewSchema = Type.Object({
	id: revision,
	expiresAt: Type.Number(),
	revision,
	config: WatchingConfigSchema,
	destination: Type.String(),
	providers: Type.Array(Type.String()),
	works: Type.Array(
		Type.Object({
			workKey: key,
			title: Type.String(),
			startEpisode: Type.Union([
				Type.Integer({ minimum: 1, maximum: 10000 }),
				Type.Null(),
			]),
			reason: Type.String(),
		}),
	),
});
export const WatchingPreviewInputSchema = Type.Object(
	{ revision, config: WatchingConfigSchema },
	{ additionalProperties: false },
);
export const WatchingConfirmSchema = Type.Object(
	{ id: revision },
	{ additionalProperties: false },
);
export const WatchingDisableSchema = Type.Object(
	{ revision },
	{ additionalProperties: false },
);
export const WatchingOverrideSchema = Type.Object(
	{
		accountId: key,
		trackingGeneration: revision,
		workKey: key,
		revision: Type.Union([revision, Type.Null()]),
		excluded: Type.Boolean(),
		paused: Type.Boolean(),
	},
	{ additionalProperties: false },
);
