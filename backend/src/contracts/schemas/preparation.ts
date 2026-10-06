import { Type } from "typebox";
import { NonnegativeIntegerSchema, ResourceIdSchema } from "./common.js";
import { AudioStreamSelectionSchema } from "./compatibility.js";
import { CompletedPlaybackResourceSchema } from "./media.js";
import {
	DirectPlaybackPlanSchema,
	PlaybackTokenSchema,
	SourceVersionSchema,
} from "./playback.js";

const statuses = {
	queued: "queued",
	processing: "processing",
	cancelling: "cancelling",
	ready: "ready",
	failed: "failed",
	cancelled: "cancelled",
} as const;
const failures = {
	interrupted: "interrupted",
	cancelled: "cancelled",
	"cache-deleted": "cache-deleted",
	"cache-missing": "cache-missing",
	"cache-full": "cache-full",
	"storage-full": "storage-full",
	"source-changed": "source-changed",
	"profile-changed": "profile-changed",
	"tool-unavailable": "tool-unavailable",
	"capability-missing": "capability-missing",
	"capability-unknown": "capability-unknown",
	"processing-failed": "processing-failed",
} as const;
export const preparationStatuses = [
	statuses.queued,
	...Object.values(statuses).filter((value) => value !== statuses.queued),
] as const;
export const preparationFailureReasons = [
	failures.interrupted,
	...Object.values(failures).filter((value) => value !== failures.interrupted),
] as const;
const nullableNumber = Type.Union([Type.Number({ minimum: 0 }), Type.Null()]);
export const PreparationProgressSchema = Type.Object(
	{
		mediaTimeMs: nullableNumber,
		speed: nullableNumber,
		percent: Type.Union([
			Type.Number({ minimum: 0, maximum: 100 }),
			Type.Null(),
		]),
	},
	{ additionalProperties: false },
);
export const PreparationTaskParamsSchema = Type.Object(
	{ id: PlaybackTokenSchema },
	{ additionalProperties: false },
);
export const PreparedArtifactParamsSchema = Type.Object(
	{ id: Type.String({ pattern: "^[a-f0-9]{64}$" }) },
	{ additionalProperties: false },
);
export const PreparationTaskSchema = Type.Object(
	{
		id: PlaybackTokenSchema,
		fileId: ResourceIdSchema,
		filename: Type.String(),
		sourceVersion: SourceVersionSchema,
		profileId: Type.String(),
		audioStreamIndices: Type.Optional(AudioStreamSelectionSchema),
		mode: Type.Union([
			Type.Literal("remux"),
			Type.Literal("transcode-audio"),
			Type.Literal("transcode-video"),
			Type.Literal("transcode"),
		]),
		reasons: Type.Object(
			{ video: Type.String(), audio: Type.String() },
			{ additionalProperties: false },
		),
		status: Type.Enum(statuses),
		playbackAvailability: Type.Union([
			Type.Literal("ready"),
			Type.Literal("unknown"),
			Type.Literal("unavailable"),
		]),
		progress: Type.Union([PreparationProgressSchema, Type.Null()]),
		failureReason: Type.Union([Type.Enum(failures), Type.Null()]),
		createdAtMs: NonnegativeIntegerSchema,
		updatedAtMs: NonnegativeIntegerSchema,
		artifactId: Type.Union([
			Type.String({ pattern: "^[a-f0-9]{64}$" }),
			Type.Null(),
		]),
		resource: Type.Union([CompletedPlaybackResourceSchema, Type.Null()]),
		sizeBytes: Type.Union([NonnegativeIntegerSchema, Type.Null()]),
	},
	{ additionalProperties: false },
);
export const PreparationStartResponseSchema = Type.Union([
	Type.Object(
		{ kind: Type.Literal("direct"), plan: DirectPlaybackPlanSchema },
		{ additionalProperties: false },
	),
	Type.Object(
		{ kind: Type.Literal("blocked"), reason: Type.String() },
		{ additionalProperties: false },
	),
	Type.Object(
		{ kind: Type.Literal("task"), task: PreparationTaskSchema },
		{ additionalProperties: false },
	),
]);
export const PreparationListResponseSchema = Type.Object(
	{ tasks: Type.Array(PreparationTaskSchema) },
	{ additionalProperties: false },
);

export const PreparationSummaryRequestSchema = Type.Object(
	{
		fileIds: Type.Array(ResourceIdSchema, { maxItems: 500, uniqueItems: true }),
	},
	{ additionalProperties: false },
);
export const PreparationSummaryResponseSchema = Type.Object(
	{
		files: Type.Array(
			Type.Object(
				{
					fileId: ResourceIdSchema,
					versions: Type.Array(
						Type.Object(
							{
								sourceVersion: SourceVersionSchema,
								publishedCopies: NonnegativeIntegerSchema,
								pendingTasks: NonnegativeIntegerSchema,
							},
							{ additionalProperties: false },
						),
					),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
