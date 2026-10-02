import { Type } from "typebox";
import { NonnegativeIntegerSchema, ResourceIdSchema } from "./common.js";
import { SourceVersionSchema } from "./playback.js";
export const SubtitleDiscoveryResponseSchema = Type.Object(
	{
		sourceVersion: SourceVersionSchema,
		tracks: Type.Array(
			Type.Object(
				{
					id: ResourceIdSchema,
					name: Type.String(),
					format: Type.Union([
						Type.Literal("vtt"),
						Type.Literal("srt"),
						Type.Literal("ass"),
						Type.Literal("ssa"),
					]),
					language: Type.Union([Type.String(), Type.Null()]),
					label: Type.Union([Type.String(), Type.Null()]),
					sizeBytes: NonnegativeIntegerSchema,
					sourceVersion: SourceVersionSchema,
				},
				{ additionalProperties: false },
			),
		),
		warnings: Type.Array(
			Type.Object(
				{
					name: Type.String(),
					code: Type.Union([
						Type.Literal("RESOURCE_MISSING"),
						Type.Literal("RESOURCE_UNREADABLE"),
						Type.Literal("RESOURCE_ACCESS_DENIED"),
						Type.Literal("SUBTITLE_TOO_LARGE"),
					]),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
