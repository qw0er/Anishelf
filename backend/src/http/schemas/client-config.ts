import { Type } from "typebox";
import { defaultLanguage } from "../../public/defaults.js";
import { subtitleFormats } from "../../public/subtitles.js";

const integer = () => Type.Integer({ minimum: 1 });
export const ClientConfigResponseSchema = Type.Object(
	{
		defaultLanguage: Type.Literal(defaultLanguage),
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
				formats: Type.Array(Type.Enum(subtitleFormats)),
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
