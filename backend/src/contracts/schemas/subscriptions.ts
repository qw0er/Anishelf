import { Type } from "typebox";

const workKey = Type.String({ minLength: 1, maxLength: 1024 });
const revision = Type.String({ minLength: 1, maxLength: 64 });
const nullableNumber = Type.Union([Type.Number(), Type.Null()]);
const AcquisitionCandidateSchema = Type.Object({
	id: Type.String(),
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
export const SubscriptionPreviewInputSchema = Type.Object(
	{
		workKey,
		rssUrl: Type.String({ maxLength: 4096 }),
		startEpisode: Type.Integer({ minimum: 1, maximum: 10000 }),
		revision: Type.Union([revision, Type.Null()]),
	},
	{ additionalProperties: false },
);
export const SubscriptionPreviewSchema = Type.Object({
	downloadDestination: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	token: Type.String(),
	expiresAt: Type.Number(),
	source: Type.String(),
	startEpisode: Type.Integer(),
	availableEpisodes: Type.Array(Type.Integer()),
	knownEpisodeCount: nullableNumber,
	candidates: Type.Array(AcquisitionCandidateSchema),
	total: Type.Integer(),
});
export const SubscriptionCommandSchema = Type.Object(
	{ workKey, revision },
	{ additionalProperties: false },
);
export const SubscriptionToggleSchema = Type.Object(
	{ workKey, revision, enabled: Type.Boolean() },
	{ additionalProperties: false },
);
export const SubscriptionConfirmSchema = Type.Object(
	{ workKey, token: Type.String({ minLength: 1, maxLength: 64 }) },
	{ additionalProperties: false },
);
