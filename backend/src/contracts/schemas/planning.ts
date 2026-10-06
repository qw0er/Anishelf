import { Type } from "typebox";
import { ResourceIdSchema } from "./common.js";
import { CompatibilityCheckRequestSchema } from "./compatibility.js";
import { PlaybackPlanSchema } from "./playback.js";

export const MediaPlanningRequestSchema = Type.Object(
	{
		fileId: ResourceIdSchema,
		...CompatibilityCheckRequestSchema.properties,
	},
	{ additionalProperties: false },
);

/** Plans carry decisions only. No pending URL, paths, leases or raw FFmpeg settings. */
export const MediaPlanningResponseSchema = Type.Union([
	Type.Object(
		{ kind: Type.Literal("playable"), plan: PlaybackPlanSchema },
		{ additionalProperties: false },
	),
	Type.Object(
		{ kind: Type.Literal("blocked"), reason: Type.String() },
		{ additionalProperties: false },
	),
	Type.Object(
		{
			kind: Type.Literal("processing-required"),
			target: Type.Union([Type.Literal("file"), Type.Literal("media-source")]),
			executionPlanId: Type.String(),
			mode: Type.String(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			kind: Type.Literal("hls-required"),
			executionPlanId: Type.String(),
			segmentContainer: Type.Literal("fmp4"),
			targetSegmentDurationMs: Type.Integer({ minimum: 1 }),
			video: Type.Object(
				{
					sourceStreamIndex: Type.Integer({ minimum: 0 }),
					action: Type.Union([Type.Literal("copy"), Type.Literal("encode")]),
					reason: Type.String(),
				},
				{ additionalProperties: false },
			),
			audioTracks: Type.Array(
				Type.Object(
					{
						sourceStreamIndex: Type.Integer({ minimum: 0 }),
						trackId: ResourceIdSchema,
						action: Type.Union([Type.Literal("copy"), Type.Literal("encode")]),
						reason: Type.String(),
					},
					{ additionalProperties: false },
				),
			),
		},
		{ additionalProperties: false },
	),
]);
