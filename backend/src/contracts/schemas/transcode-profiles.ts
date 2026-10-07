import { Type } from "typebox";

export const TranscodeProfileIdSchema = Type.String({
	pattern: "^(builtin|custom):[a-z][a-z0-9-]{0,63}$",
});
const text = () =>
	Type.String({ minLength: 1, maxLength: 240, pattern: "\\S" });
const pixelFormat = Type.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" });
const videoFields = {
	pixelFormat,
	maxHeight: Type.Optional(
		Type.Integer({ minimum: 2, maximum: 8192, multipleOf: 2 }),
	),
};
const x26xPreset = Type.Union([
	Type.Literal("ultrafast"),
	Type.Literal("superfast"),
	Type.Literal("veryfast"),
	Type.Literal("faster"),
	Type.Literal("fast"),
	Type.Literal("medium"),
	Type.Literal("slow"),
	Type.Literal("slower"),
	Type.Literal("veryslow"),
]);
const hardwareBitrate = Type.Integer({ minimum: 1, maximum: 1000000 });
/** Parameters belong to their encoder. No generic CRF/preset interpretation. */
export const TranscodeVideoSchema = Type.Union([
	Type.Object(
		{
			...videoFields,
			encoder: Type.Literal("libx264"),
			codec: Type.Literal("h264"),
			crf: Type.Integer({ minimum: 0, maximum: 51 }),
			preset: x26xPreset,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...videoFields,
			encoder: Type.Literal("libx265"),
			codec: Type.Literal("hevc"),
			crf: Type.Integer({ minimum: 0, maximum: 51 }),
			preset: x26xPreset,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...videoFields,
			encoder: Type.Literal("libsvtav1"),
			codec: Type.Literal("av1"),
			crf: Type.Integer({ minimum: 0, maximum: 63 }),
			preset: Type.Integer({ minimum: 0, maximum: 13 }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...videoFields,
			encoder: Type.Literal("libaom-av1"),
			codec: Type.Literal("av1"),
			crf: Type.Integer({ minimum: 0, maximum: 63 }),
			cpuUsed: Type.Integer({ minimum: 0, maximum: 8 }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...videoFields,
			encoder: Type.Literal("libvpx-vp9"),
			codec: Type.Literal("vp9"),
			crf: Type.Integer({ minimum: 0, maximum: 63 }),
			cpuUsed: Type.Integer({ minimum: 0, maximum: 5 }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...videoFields,
			encoder: Type.Literal("h264_nvenc"),
			codec: Type.Literal("h264"),
			bitrateKbps: hardwareBitrate,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...videoFields,
			encoder: Type.Literal("hevc_nvenc"),
			codec: Type.Literal("hevc"),
			bitrateKbps: hardwareBitrate,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...videoFields,
			encoder: Type.Literal("av1_nvenc"),
			codec: Type.Literal("av1"),
			bitrateKbps: hardwareBitrate,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...videoFields,
			encoder: Type.Literal("h264_qsv"),
			codec: Type.Literal("h264"),
			bitrateKbps: hardwareBitrate,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...videoFields,
			encoder: Type.Literal("hevc_qsv"),
			codec: Type.Literal("hevc"),
			bitrateKbps: hardwareBitrate,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...videoFields,
			encoder: Type.Literal("av1_qsv"),
			codec: Type.Literal("av1"),
			bitrateKbps: hardwareBitrate,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...videoFields,
			encoder: Type.Literal("h264_videotoolbox"),
			codec: Type.Literal("h264"),
			bitrateKbps: hardwareBitrate,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...videoFields,
			encoder: Type.Literal("hevc_videotoolbox"),
			codec: Type.Literal("hevc"),
			bitrateKbps: hardwareBitrate,
		},
		{ additionalProperties: false },
	),
]);
const audioFields = {
	channels: Type.Union([Type.Literal("preserve"), Type.Literal("stereo")]),
};
export const TranscodeAudioSchema = Type.Union([
	Type.Object(
		{
			...audioFields,
			encoder: Type.Literal("aac"),
			codec: Type.Literal("aac"),
			bitrateKbps: Type.Integer({ minimum: 32, maximum: 512 }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...audioFields,
			encoder: Type.Literal("libopus"),
			codec: Type.Literal("opus"),
			bitrateKbps: Type.Integer({ minimum: 6, maximum: 510 }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...audioFields,
			encoder: Type.Literal("libvorbis"),
			codec: Type.Literal("vorbis"),
			bitrateKbps: Type.Integer({ minimum: 32, maximum: 500 }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...audioFields,
			encoder: Type.Literal("flac"),
			codec: Type.Literal("flac"),
			compressionLevel: Type.Integer({ minimum: 0, maximum: 12 }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...audioFields,
			encoder: Type.Literal("alac"),
			codec: Type.Literal("alac"),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...audioFields,
			encoder: Type.Literal("pcm_s16le"),
			codec: Type.Literal("pcm_s16le"),
		},
		{ additionalProperties: false },
	),
]);
/** Shared by built-in definitions and administrator-authored JSON. No raw arguments. */
export const TranscodeProfileSchema = Type.Object(
	{
		id: TranscodeProfileIdSchema,
		name: text(),
		description: text(),
		usage: Type.Literal("preparation"),
		container: Type.Union([
			Type.Literal("mp4"),
			Type.Literal("webm"),
			Type.Literal("matroska"),
			Type.Literal("mov"),
		]),
		copyCompatibleStreams: Type.Boolean(),
		video: TranscodeVideoSchema,
		audio: TranscodeAudioSchema,
	},
	{ additionalProperties: false },
);
export const TranscodeProfilesFileSchema = Type.Object(
	{
		version: Type.Literal(1),
		profiles: Type.Array(TranscodeProfileSchema, { maxItems: 100 }),
	},
	{ additionalProperties: false },
);
/** User-facing catalog deliberately omits encoding parameters. Availability is not certified here. */
export const PreparationModeSchema = Type.Union([
	Type.Literal("compatible"),
	Type.Literal("fast"),
]);

export const TranscodeProfileCatalogSchema = Type.Object(
	{
		profiles: Type.Array(
			Type.Object(
				{
					id: TranscodeProfileIdSchema,
					name: text(),
					description: text(),
					container: Type.Union([
						Type.Literal("mp4"),
						Type.Literal("webm"),
						Type.Literal("matroska"),
						Type.Literal("mov"),
					]),
					videoEncoder: Type.String(),
					audioEncoder: Type.String(),
					source: Type.Union([Type.Literal("builtin"), Type.Literal("custom")]),
					usage: Type.Literal("preparation"),
				},
				{ additionalProperties: false },
			),
		),
		selectedProfileId: TranscodeProfileIdSchema,
		preparationMode: PreparationModeSchema,
		selectionAvailable: Type.Boolean(),
	},
	{ additionalProperties: false },
);
export const SelectTranscodeProfileSchema = Type.Object(
	{
		profileId: Type.Union([TranscodeProfileIdSchema, Type.Null()]),
		preparationMode: Type.Optional(PreparationModeSchema),
	},
	{ additionalProperties: false },
);
