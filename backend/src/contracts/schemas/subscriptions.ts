import { Type } from "typebox";
import { ProfileCatalogIssueSchema } from "./profile-issues.js";
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
	issue: Type.Optional(ProfileCatalogIssueSchema),
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
const DiscoveryAttemptSchema = Type.Object({
	providerId: Type.String(),
	reasons: Type.Array(Type.String()),
	outcome: Type.Union([
		Type.Literal("matched"),
		Type.Literal("no_match"),
		Type.Literal("no_eligible"),
		Type.Literal("unavailable"),
	]),
	code: Type.Union([Type.String(), Type.Null()]),
	retryAt: Type.Optional(Type.Number()),
	limited: Type.Boolean(),
});
export const SubscriptionViewSchema = Type.Object({
	discovery: Type.Optional(
		Type.Object({
			checkedAt: Type.Number(),
			attempts: Type.Array(DiscoveryAttemptSchema),
		}),
	),
	subscription: Type.Union([
		Type.Null(),
		Type.Object({
			workKey,
			feedId: Type.Union([Type.String(), Type.Null()]),
			startEpisode: Type.Integer(),
			profileId,
			enabled: Type.Boolean(),
			revision,
			source: Type.String(),
			sourceKind: Type.Union([
				Type.Literal("feed"),
				Type.Literal("search"),
				Type.Literal("automatic"),
			]),
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
		source: Type.Union([
			SourceInputSchema,
			Type.Object(
				{ kind: Type.Literal("automatic") },
				{ additionalProperties: false },
			),
			Type.Null(),
		]),
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
