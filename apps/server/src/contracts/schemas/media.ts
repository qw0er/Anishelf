import { Type } from "typebox";
import { NonnegativeIntegerSchema, PositiveIntegerSchema } from "./common.js";

/** An affine mapping between media-element time and durable source-file time. */
export const MediaTimelineSchema = Type.Object(
	{
		sourceOriginMs: NonnegativeIntegerSchema,
		mediaOriginMs: NonnegativeIntegerSchema,
		sourceDurationMs: Type.Union([PositiveIntegerSchema, Type.Null()]),
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
