import { Type } from "typebox";
import {
	NonnegativeIntegerSchema,
	PositiveIntegerSchema,
	ResourceIdSchema,
} from "./common.js";
import { FileDtoSchema } from "./library.js";
import {
	CompletedPlaybackResourceSchema,
	FilePlaybackResourceSchema,
	HlsPlaybackResourceSchema,
} from "./media.js";

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
/** Resource references only. Pending plans have no playable URL. */
export const PlaybackPlanSchema = Type.Union([
	DirectPlaybackPlanSchema,
	Type.Object(
		{
			mode: Type.Literal("prepared"),
			artifactId: ResourceIdSchema,
			resource: CompletedPlaybackResourceSchema,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{ mode: Type.Literal("preparing"), taskId: ResourceIdSchema },
		{ additionalProperties: false },
	),
	Type.Object(
		{
			mode: Type.Literal("realtime"),
			sessionId: PlaybackTokenSchema,
			resource: HlsPlaybackResourceSchema,
			streamGeneration: PositiveIntegerSchema,
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
		generation: PositiveIntegerSchema,
		sourceVersion: SourceVersionSchema,
		file: FileDtoSchema,
		plan: PlaybackPlanSchema,
		progress: PlaybackProgressDtoSchema,
	},
	{ additionalProperties: false },
);
export const SavePlaybackProgressRequestSchema = Type.Object(
	{
		generation: PositiveIntegerSchema,
		sourceVersion: SourceVersionSchema,
		sequence: PositiveIntegerSchema,
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
export const ContinueWatchingQuerySchema = Type.Object(
	{ limit: Type.Optional(Type.String({ pattern: "^[1-9][0-9]*$" })) },
	{ additionalProperties: false },
);
export const ContinueWatchingResponseSchema = Type.Object(
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
