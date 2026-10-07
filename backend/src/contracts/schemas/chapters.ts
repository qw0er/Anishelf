import { Type } from "typebox";
import { NonnegativeIntegerSchema, PositiveIntegerSchema } from "./common.js";
import { SourceVersionSchema } from "./playback.js";

export const ChapterQuerySchema = Type.Object(
	{ sourceVersion: SourceVersionSchema },
	{ additionalProperties: false },
);
export const ChaptersResponseSchema = Type.Object(
	{
		sourceVersion: SourceVersionSchema,
		chapters: Type.Array(
			Type.Object(
				{
					title: Type.Union([Type.String(), Type.Null()]),
					startMs: NonnegativeIntegerSchema,
					endMs: PositiveIntegerSchema,
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
