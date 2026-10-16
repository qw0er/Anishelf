import { Type } from "typebox";
import {
	NonnegativeIntegerSchema,
	PositiveIntegerSchema,
	ResourceIdSchema,
} from "./common.js";
import { FileDtoSchema } from "./library.js";
import { FilePlaybackResourceSchema } from "./media.js";

export const PlaybackTokenSchema = Type.String({
	minLength: 36,
	maxLength: 36,
	pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
});
export const PlaybackTokenParamsSchema = Type.Object(
	{ token: PlaybackTokenSchema },
	{ additionalProperties: false },
);
export const SourceVersionSchema = Type.String({
	minLength: 1,
	maxLength: 128,
	pattern: "^[A-Za-z0-9_-]+$",
});
const durationSchema = Type.Union([PositiveIntegerSchema, Type.Null()]);
export const PlaybackProgressDtoSchema = Type.Object(
	{
		positionMs: NonnegativeIntegerSchema,
		durationMs: durationSchema,
		lastViewedAtMs: Type.Union([NonnegativeIntegerSchema, Type.Null()]),
		generation: PositiveIntegerSchema,
		lastSequence: NonnegativeIntegerSchema,
	},
	{ additionalProperties: false },
);
export const OpenPlaybackRequestSchema = Type.Object(
	{ fileId: ResourceIdSchema },
	{ additionalProperties: false },
);
export const DirectPlaybackPlanSchema = Type.Object(
	{ mode: Type.Literal("direct"), resource: FilePlaybackResourceSchema },
	{ additionalProperties: false },
);
/** Resource references only. Waiting is represented by selection.pending and a blocked plan. */
export const PlaybackPlanSchema = Type.Union([
	DirectPlaybackPlanSchema,
	Type.Object(
		{
			mode: Type.Literal("prepared"),
			artifactId: ResourceIdSchema,
			resource: FilePlaybackResourceSchema,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{ mode: Type.Literal("blocked"), reason: Type.String({ minLength: 1 }) },
		{ additionalProperties: false },
	),
]);
export const PlaybackSessionResponseSchema = Type.Object(
	{
		token: PlaybackTokenSchema,
		completionEnabled: Type.Optional(Type.Boolean()),
		sourceVersion: SourceVersionSchema,
		file: FileDtoSchema,
		progress: PlaybackProgressDtoSchema,
	},
	{ additionalProperties: false },
);
export const CompletionOutcomeSchema = Type.Union([
	Type.Null(),
	Type.Object(
		{
			state: Type.Union([
				Type.Literal("pending"),
				Type.Literal("decision-required"),
				Type.Literal("queued"),
				Type.Literal("skipped"),
				Type.Literal("unavailable"),
			]),
			reason: Type.String(),
			episode: Type.Optional(PositiveIntegerSchema),
			mediaId: Type.Optional(PositiveIntegerSchema),
		},
		{ additionalProperties: false },
	),
]);
export const CompletionDecisionSchema = Type.Object(
	{
		advance: Type.Boolean(),
		initialStatus: Type.Optional(
			Type.Union([
				Type.Literal("CURRENT"),
				Type.Literal("PLANNING"),
				Type.Literal("COMPLETED"),
				Type.Literal("PAUSED"),
				Type.Literal("DROPPED"),
				Type.Literal("REPEATING"),
			]),
		),
	},
	{ additionalProperties: false },
);
export const SavePlaybackProgressRequestSchema = Type.Object(
	{
		generation: PositiveIntegerSchema,
		sourceVersion: SourceVersionSchema,
		sequence: PositiveIntegerSchema,
		intervals: Type.Optional(
			Type.Array(
				Type.Object(
					{
						startMs: NonnegativeIntegerSchema,
						endMs: PositiveIntegerSchema,
						elapsedMs: Type.Number({ exclusiveMinimum: 0, maximum: 300000 }),
						rate: Type.Number({ minimum: 0.25, maximum: 16 }),
					},
					{ additionalProperties: false },
				),
				{ maxItems: 128 },
			),
		),
		positionMs: NonnegativeIntegerSchema,
		durationMs: durationSchema,
	},
	{ additionalProperties: false },
);
export const SavePlaybackProgressResponseSchema = Type.Object(
	{
		status: Type.Union([Type.Literal("saved"), Type.Literal("duplicate")]),
		progress: PlaybackProgressDtoSchema,
	},
	{ additionalProperties: false },
);
export const HistoryQuerySchema = Type.Object(
	{ limit: Type.Optional(Type.String({ pattern: "^[1-9][0-9]*$" })) },
	{ additionalProperties: false },
);
export const HistoryResponseSchema = Type.Object(
	{
		availability: Type.Union([
			Type.Literal("unknown"),
			Type.Literal("checked"),
		]),
		items: Type.Array(
			Type.Object(
				{ file: FileDtoSchema, progress: PlaybackProgressDtoSchema },
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
