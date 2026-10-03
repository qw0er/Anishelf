import { Type } from "typebox";
import { subtitleFormats } from "../../public/subtitles.js";
import { NonnegativeIntegerSchema, ResourceIdSchema } from "./common.js";
import { SourceVersionSchema } from "./playback.js";

const SubtitleFormatSchema = Type.Enum(subtitleFormats);
const subtitleFields = {
	id: ResourceIdSchema,
	name: Type.String(),
	language: Type.Union([Type.String(), Type.Null()]),
	label: Type.Union([Type.String(), Type.Null()]),
	sourceVersion: SourceVersionSchema,
};
export const SubtitleDiscoveryResponseSchema = Type.Object(
	{
		sourceVersion: SourceVersionSchema,
		tracks: Type.Array(
			Type.Union([
				Type.Object(
					{
						...subtitleFields,
						origin: Type.Literal("external"),
						format: SubtitleFormatSchema,
						sizeBytes: NonnegativeIntegerSchema,
					},
					{ additionalProperties: false },
				),
				Type.Object(
					{
						...subtitleFields,
						origin: Type.Literal("embedded"),
						format: Type.Union([SubtitleFormatSchema, Type.Null()]),
						sizeBytes: Type.Null(),
						codec: Type.Union([Type.String(), Type.Null()]),
						default: Type.Boolean(),
						forced: Type.Boolean(),
						extractionSupported: Type.Boolean(),
						webSupported: Type.Boolean(),
						unsupportedReason: Type.Union([
							Type.Literal("UNSUPPORTED_CODEC"),
							Type.Literal("UNSUPPORTED_FORMAT"),
							Type.Null(),
						]),
					},
					{ additionalProperties: false },
				),
			]),
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
						Type.Literal("SUBTITLE_PROBE_UNAVAILABLE"),
						Type.Literal("SUBTITLE_PROBE_FAILED"),
						Type.Literal("SUBTITLE_PROBE_BUSY"),
					]),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

export const SubtitleContentParamsSchema = Type.Object(
	{ id: ResourceIdSchema, trackId: ResourceIdSchema },
	{ additionalProperties: false },
);
export const SubtitleContentQuerySchema = Type.Object(
	{ sourceVersion: SourceVersionSchema, subtitleVersion: SourceVersionSchema },
	{ additionalProperties: false },
);

export const PrepareSubtitleRequestSchema = Type.Object(
	{ sourceVersion: SourceVersionSchema },
	{ additionalProperties: false },
);
export const SubtitleAssetParamsSchema = Type.Object(
	{ id: ResourceIdSchema },
	{ additionalProperties: false },
);
export const SubtitlePreparationResponseSchema = Type.Object(
	{
		id: ResourceIdSchema,
		status: Type.Union([
			Type.Literal("pending"),
			Type.Literal("ready"),
			Type.Literal("failed"),
		]),
		format: SubtitleFormatSchema,
		errorCode: Type.Union([
			Type.Null(),
			Type.Literal("SUBTITLE_EXTRACTION_FAILED"),
			Type.Literal("SUBTITLE_TOOL_UNAVAILABLE"),
			Type.Literal("SUBTITLE_TOO_LARGE"),
			Type.Literal("SUBTITLE_CACHE_FULL"),
			Type.Literal("PLAYBACK_CONFLICT"),
			Type.Literal("SUBTITLE_INTERRUPTED"),
		]),
		statusUrl: Type.String(),
		contentUrl: Type.Union([Type.String(), Type.Null()]),
	},
	{ additionalProperties: false },
);
