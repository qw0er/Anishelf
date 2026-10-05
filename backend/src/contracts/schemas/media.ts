import { Type } from "typebox";
import {
	NonnegativeIntegerSchema,
	PositiveIntegerSchema,
	ResourceIdSchema,
} from "./common.js";

/** An affine mapping between media-element time and durable source-file time. */
export const MediaTimelineSchema = Type.Object(
	{
		sourceOriginMs: NonnegativeIntegerSchema,
		mediaOriginMs: NonnegativeIntegerSchema,
		sourceDurationMs: Type.Union([PositiveIntegerSchema, Type.Null()]),
	},
	{ additionalProperties: false },
);

export const MediaTrackSchema = Type.Object(
	{
		id: ResourceIdSchema,
		kind: Type.Union([
			Type.Literal("video"),
			Type.Literal("audio"),
			Type.Literal("subtitles"),
		]),
		sourceStreamIndex: Type.Union([NonnegativeIntegerSchema, Type.Null()]),
		label: Type.String(),
		language: Type.Union([Type.String(), Type.Null()]),
		codec: Type.Union([Type.String(), Type.Null()]),
		default: Type.Boolean(),
	},
	{ additionalProperties: false },
);

export const FilePlaybackResourceSchema = Type.Object(
	{
		delivery: Type.Literal("file"),
		url: Type.String({ minLength: 1 }),
		mimeType: Type.String({ minLength: 1 }),
		timeline: MediaTimelineSchema,
	},
	{ additionalProperties: false },
);

export const HlsPlaybackResourceSchema = Type.Object(
	{
		delivery: Type.Literal("hls"),
		resourceId: ResourceIdSchema,
		url: Type.String({ minLength: 1 }),
		mimeType: Type.Literal("application/vnd.apple.mpegurl"),
		/** This is the stream generation, never a progress/history generation. */
		streamGeneration: PositiveIntegerSchema,
		completeness: Type.Union([
			Type.Literal("complete"),
			Type.Literal("growing"),
		]),
		timeline: MediaTimelineSchema,
		tracks: Type.Array(MediaTrackSchema),
		availableRanges: Type.Array(
			Type.Object(
				{
					startMs: NonnegativeIntegerSchema,
					endMs: PositiveIntegerSchema,
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

export const PlaybackResourceSchema = Type.Union([
	FilePlaybackResourceSchema,
	HlsPlaybackResourceSchema,
]);

/** A durable prepared resource cannot reference a still-growing stream. */
export const CompletedPlaybackResourceSchema = Type.Union([
	FilePlaybackResourceSchema,
	Type.Object(
		{
			...HlsPlaybackResourceSchema.properties,
			completeness: Type.Literal("complete"),
		},
		{ additionalProperties: false },
	),
]);
