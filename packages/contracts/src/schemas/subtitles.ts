import { Type } from "typebox";
import { subtitleFormats } from "../subtitles.ts";
import { NonnegativeIntegerSchema, ResourceIdSchema } from "./common.ts";
import { SourceVersionSchema } from "./playback.ts";

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
			Type.Object(
				{
					...subtitleFields,
					origin: Type.Union([
						Type.Literal("external"),
						Type.Literal("embedded"),
					]),
					format: Type.Union([SubtitleFormatSchema, Type.Null()]),
					sizeBytes: Type.Union([NonnegativeIntegerSchema, Type.Null()]),
					codec: Type.Union([Type.String(), Type.Null()]),
					default: Type.Boolean(),
					forced: Type.Boolean(),
					supported: Type.Boolean(),
					unsupportedReason: Type.Union([
						Type.Literal("UNSUPPORTED_CODEC"),
						Type.Literal("UNSUPPORTED_FORMAT"),
						Type.Null(),
					]),
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

export const EmbeddedSubtitleParamsSchema = Type.Object(
	{
		id: ResourceIdSchema,
		index: Type.String({ pattern: "^(0|[1-9][0-9]{0,9})$" }),
	},
	{ additionalProperties: false },
);
export const EmbeddedSubtitleQuerySchema = Type.Object(
	{
		sourceVersion: SourceVersionSchema,
		assetId: ResourceIdSchema,
		assetRevision: SourceVersionSchema,
	},
	{ additionalProperties: false },
);
export const EmbeddedSubtitleResponseSchema = Type.Object({
	text: Type.String(),
	fonts: Type.Array(
		Type.Object({
			index: NonnegativeIntegerSchema,
			sizeBytes: NonnegativeIntegerSchema,
		}),
	),
});
