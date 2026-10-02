import { Type } from "typebox";

const integer = () => Type.Integer({ minimum: 1 });
export const ClientConfigResponseSchema = Type.Object(
	{
		defaultLanguage: Type.Literal("en"),
		library: Type.Object(
			{
				defaultScanIntervalMinutes: Type.Integer({ minimum: 0 }),
				maximumScanIntervalMinutes: integer(),
			},
			{ additionalProperties: false },
		),
		playback: Type.Object(
			{ progressSaveIntervalMs: integer(), requestTimeoutMs: integer() },
			{ additionalProperties: false },
		),
		subtitles: Type.Object(
			{
				maximumBytes: integer(),
				initializationTimeoutMs: integer(),
				memoryMaximumBytes: integer(),
				formats: Type.Array(
					Type.Union([
						Type.Literal("vtt"),
						Type.Literal("srt"),
						Type.Literal("ass"),
						Type.Literal("ssa"),
					]),
				),
			},
			{ additionalProperties: false },
		),
		media: Type.Object(
			{ videoMimeTypes: Type.Record(Type.String(), Type.String()) },
			{ additionalProperties: false },
		),
	},
	{ additionalProperties: false },
);
