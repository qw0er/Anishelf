import { Type } from "typebox";

const revision = Type.String({ minLength: 1, maxLength: 64 });
const nullableString = Type.Union([Type.String(), Type.Null()]);
const nullableNumber = Type.Union([Type.Number(), Type.Null()]);
export const DownloadDestinationSchema = Type.Object({
	revision,
	scopeId: Type.String(),
	path: Type.String(),
	connectionGeneration: revision,
	validated: Type.Boolean(),
	visibilityVerified: Type.Boolean(),
});
export const DownloadSettingsSchema = Type.Object({
	destination: Type.Union([DownloadDestinationSchema, Type.Null()]),
	roots: Type.Array(
		Type.Object({ scopeId: Type.String(), name: Type.String() }),
	),
});
export const DownloadSettingsInputSchema = Type.Object(
	{
		revision: Type.Union([revision, Type.Null()]),
		scopeId: Type.String({ minLength: 1, maxLength: 200 }),
		path: Type.String({ minLength: 1, maxLength: 2048 }),
	},
	{ additionalProperties: false },
);
export const DownloadValidationSchema = Type.Object(
	{ revision },
	{ additionalProperties: false },
);
export const DownloadRetrySchema = Type.Object(
	{
		revision,
		commandId: revision,
		kind: Type.Union([Type.Literal("acquisition"), Type.Literal("import")]),
	},
	{ additionalProperties: false },
);
export const DownloadActivitySchema = Type.Object({
	planningError: Type.Optional(nullableString),
	authorized: Type.Boolean(),
	destination: nullableString,
	page: Type.Integer(),
	total: Type.Integer(),
	active: Type.Integer(),
	attention: Type.Integer(),
	managedCandidateIds: Type.Array(Type.String(), { maxItems: 2000 }),
	items: Type.Array(
		Type.Object({
			id: Type.String(),
			revision,
			workKey: Type.String(),
			candidateId: Type.String(),
			episode: Type.Integer(),
			title: Type.String(),
			state: Type.Union([
				Type.Literal("pending"),
				Type.Literal("submitting"),
				Type.Literal("unknown"),
				Type.Literal("bound"),
				Type.Literal("blocked"),
				Type.Literal("missing"),
				Type.Literal("available"),
			]),
			transfer: nullableString,
			progress: nullableNumber,
			ingestion: Type.Union([
				Type.Literal("not-ready"),
				Type.Literal("pending"),
				Type.Literal("validating"),
				Type.Literal("review"),
				Type.Literal("failed"),
				Type.Literal("available"),
			]),
			error: nullableString,
			attempts: Type.Integer(),
			nextAttemptAt: Type.Number(),
			observedAt: nullableNumber,
			createdAt: Type.Number(),
			updatedAt: Type.Number(),
		}),
	),
});
