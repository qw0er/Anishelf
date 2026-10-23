import { Type } from "typebox";
import { SourceInputSchema } from "./sources.js";

const workKey = Type.String({ minLength: 1, maxLength: 1024 });
const revision = Type.String({ minLength: 1, maxLength: 64 });
const nullableNumber = Type.Union([Type.Number(), Type.Null()]);
export const AcquisitionProfileCatalogSchema = Type.Object({
	profiles: Type.Array(
		Type.Object({
			id: Type.String(),
			name: Type.String(),
			description: Type.String(),
			source: Type.Union([Type.Literal("builtin"), Type.Literal("custom")]),
		}),
	),
	selectedProfileId: Type.String(),
	selectionAvailable: Type.Boolean(),
});
const profileId = Type.Optional(
	Type.Union([
		Type.String({ pattern: "^(builtin|custom):[a-z][a-z0-9-]{0,63}$" }),
		Type.Null(),
	]),
);
const AcquisitionCandidateSchema = Type.Object({
	id: Type.String(),
	selection: Type.Optional(
		Type.Object({
			profileId: Type.String(),
			fingerprint: Type.String(),
			level: Type.Union([Type.String(), Type.Null()]),
			firstSeenAt: nullableNumber,
			eligibleAt: nullableNumber,
			seeders: nullableNumber,
		}),
	),
	workKey,
	entryId: Type.String(),
	title: Type.String(),
	episode: nullableNumber,
	status: Type.Union([Type.Literal("selected"), Type.Literal("skipped")]),
	reasons: Type.Array(Type.String()),
	version: Type.String(),
	snapshotId: Type.String(),
	publishedAt: nullableNumber,
});
export const SubscriptionViewSchema = Type.Object({
	subscription: Type.Union([
		Type.Null(),
		Type.Object({
			workKey,
			feedId: Type.String(),
			startEpisode: Type.Integer(),
			profileId,
			enabled: Type.Boolean(),
			revision,
			source: Type.String(),
			checkedAt: nullableNumber,
			nextAttemptAt: Type.Number(),
			error: Type.Union([Type.String(), Type.Null()]),
		}),
	]),
	candidates: Type.Array(AcquisitionCandidateSchema),
	total: Type.Integer(),
	page: Type.Integer(),
});
export const SubscriptionSaveSchema = Type.Object(
	{
		workKey,
		source: Type.Union([SourceInputSchema, Type.Null()]),
		profileId,
		startEpisode: Type.Integer({ minimum: 1, maximum: 10000 }),
		revision: Type.Union([revision, Type.Null()]),
		destinationRevision: revision,
		connectionGeneration: revision,
	},
	{ additionalProperties: false },
);
export const SubscriptionCommandSchema = Type.Object(
	{ workKey, revision },
	{ additionalProperties: false },
);
export const SubscriptionToggleSchema = Type.Object(
	{ workKey, revision, enabled: Type.Boolean() },
	{ additionalProperties: false },
);
