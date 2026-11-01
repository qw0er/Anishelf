import { Type } from "typebox";
import { ProfileCatalogIssueSchema } from "./profile-issues.js";
import { TranscodeProfileIdSchema } from "./transcode-profiles.js";

const strings = () =>
	Type.Optional(
		Type.Array(Type.String({ minLength: 1, maxLength: 240 }), {
			maxItems: 100,
			uniqueItems: true,
		}),
	);
const limit = () =>
	Type.Optional(
		Type.Union([
			Type.Number({ exclusiveMinimum: 0, maximum: 1000000 }),
			Type.Null(),
		]),
	);
const object = { additionalProperties: false } as const;
const VideoAcceptanceSchema = Type.Object(
	{
		codecs: strings(),
		pixelFormats: strings(),
		profiles: strings(),
		maxLevel: Type.Optional(
			Type.Union([
				Type.String({ pattern: "^[0-9]+(\\.[0-9]+)?$" }),
				Type.Null(),
			]),
		),
		maxWidth: limit(),
		maxHeight: limit(),
		maxFrameRate: limit(),
		maxBitrateKbps: limit(),
		dynamicRanges: Type.Optional(
			Type.Array(
				Type.Union([
					Type.Literal("sdr"),
					Type.Literal("hdr10"),
					Type.Literal("hlg"),
				]),
				{ uniqueItems: true },
			),
		),
	},
	object,
);
const AudioAcceptanceSchema = Type.Object(
	{
		codecs: strings(),
		profiles: strings(),
		maxChannels: limit(),
		sampleRates: Type.Optional(
			Type.Array(Type.Integer({ minimum: 1, maximum: 768000 }), {
				uniqueItems: true,
				maxItems: 100,
			}),
		),
		maxBitrateKbps: limit(),
	},
	object,
);
const ViewingStateSchema = Type.Union([
	Type.Literal("unwatched"),
	Type.Literal("in-progress"),
	Type.Literal("completed"),
]);
const AutoPreparationPresetSchema = Type.Object(
	{
		id: TranscodeProfileIdSchema,
		name: Type.String({ minLength: 1, maxLength: 240, pattern: "\\S" }),
		description: Type.Optional(Type.String({ maxLength: 240 })),
		match: Type.Optional(
			Type.Object(
				{
					rootIds: strings(),
					include: strings(),
					exclude: strings(),
					viewingStates: Type.Optional(
						Type.Array(ViewingStateSchema, { uniqueItems: true }),
					),
				},
				object,
			),
		),
		audio: Type.Optional(
			Type.Object(
				{
					selection: Type.Optional(
						Type.Union([
							Type.Literal("all"),
							Type.Literal("default"),
							Type.Literal("languages"),
							Type.Literal("none"),
						]),
					),
					languages: strings(),
					fallback: Type.Optional(
						Type.Union([
							Type.Literal("default"),
							Type.Literal("all"),
							Type.Literal("skip"),
						]),
					),
				},
				object,
			),
		),
		accept: Type.Optional(
			Type.Object(
				{
					containers: strings(),
					video: Type.Optional(
						Type.Array(VideoAcceptanceSchema, { maxItems: 100 }),
					),
					audio: Type.Optional(
						Type.Array(AudioAcceptanceSchema, { maxItems: 100 }),
					),
				},
				object,
			),
		),
		transcodeProfileId: TranscodeProfileIdSchema,
	},
	object,
);
export const AutoPreparationFileSchema = Type.Object(
	{
		version: Type.Literal(1),
		presets: Type.Optional(
			Type.Array(AutoPreparationPresetSchema, { maxItems: 100 }),
		),
	},
	object,
);
export const AutoPreparationCatalogSchema = Type.Object(
	{
		presets: Type.Array(
			Type.Object(
				{
					id: TranscodeProfileIdSchema,
					name: Type.String(),
					description: Type.String(),
					source: Type.Union([Type.Literal("builtin"), Type.Literal("custom")]),
					available: Type.Boolean(),
				},
				object,
			),
		),
		selectedPresetId: TranscodeProfileIdSchema,
		selectionAvailable: Type.Boolean(),
		issue: Type.Optional(ProfileCatalogIssueSchema),
	},
	object,
);
