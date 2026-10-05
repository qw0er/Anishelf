import { Type } from "typebox";
import { ResourceIdSchema } from "./common.js";
import { SourceVersionSchema } from "./playback.js";
import { TranscodeProfileIdSchema } from "./transcode-profiles.js";

const nullableNumber = Type.Union([Type.Number({ minimum: 0 }), Type.Null()]);
const nullableString = Type.Union([
	Type.String({ maxLength: 256 }),
	Type.Null(),
]);
export const CompatibilityStatusSchema = Type.Union([
	Type.Literal("supported"),
	Type.Literal("unsupported"),
	Type.Literal("unknown"),
]);
export const AudioStreamSelectionSchema = Type.Array(
	Type.Integer({ minimum: 0 }),
	{ maxItems: 128, uniqueItems: true },
);
const stream = Type.Object(
	{
		index: Type.Integer({ minimum: 0 }),
		kind: Type.Union([Type.Literal("video"), Type.Literal("audio")]),
		codec: nullableString,
		codecString: nullableString,
		profile: nullableString,
		pixelFormat: nullableString,
		bitDepth: nullableNumber,
		hdr: Type.Boolean(),
		width: nullableNumber,
		height: nullableNumber,
		frameRate: nullableNumber,
		bitrate: nullableNumber,
		sampleRate: nullableNumber,
		channels: nullableNumber,
		language: Type.Optional(nullableString),
		label: Type.Optional(nullableString),
		default: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
const query = Type.Object(
	{
		id: Type.String({ maxLength: 64 }),
		type: Type.Union([Type.Literal("file"), Type.Literal("media-source")]),
		contentType: nullableString,
		video: Type.Union([stream, Type.Null()]),
		audio: Type.Union([stream, Type.Null()]),
	},
	{ additionalProperties: false },
);
const evidence = Type.Object(
	{
		id: Type.String({ maxLength: 64 }),
		status: CompatibilityStatusSchema,
		smooth: Type.Union([Type.Boolean(), Type.Null()]),
		powerEfficient: Type.Union([Type.Boolean(), Type.Null()]),
		reason: Type.Union([
			Type.Literal("browser-supported"),
			Type.Literal("browser-rejected"),
			Type.Literal("browser-uncertain"),
			Type.Literal("api-unavailable"),
			Type.Literal("query-failed"),
			Type.Literal("query-timeout"),
			Type.Literal("incomplete-description"),
		]),
	},
	{ additionalProperties: false },
);
const decision = Type.Object(
	{
		status: CompatibilityStatusSchema,
		reason: Type.String({ maxLength: 128 }),
	},
	{ additionalProperties: false },
);
export const CompatibilityOutputRequestSchema = Type.Object(
	{
		profileId: TranscodeProfileIdSchema,
		target: Type.Union([
			Type.Literal("file"),
			Type.Literal("media-source"),
			Type.Literal("hls"),
		]),
	},
	{ additionalProperties: false },
);
const outputDescription = Type.Object(
	{
		profileId: TranscodeProfileIdSchema,
		target: Type.Union([
			Type.Literal("file"),
			Type.Literal("media-source"),
			Type.Literal("hls"),
		]),
		profileFingerprint: Type.String({ pattern: "^[a-f0-9]{64}$" }),
	},
	{ additionalProperties: false },
);
const identity = {
	fileId: ResourceIdSchema,
	sourceVersion: SourceVersionSchema,
	rulesVersion: Type.Literal("3"),
};
export const CompatibilityEvidenceListSchema = Type.Array(evidence, {
	maxItems: 1024,
});
export const CompatibilityInspectionQuerySchema = Type.Object(
	{
		sourceVersion: Type.Optional(SourceVersionSchema),
		audioStreamIndices: Type.Optional(
			Type.String({ pattern: "^(?:[0-9]+(?:,[0-9]+)*)?$", maxLength: 2048 }),
		),
		profileId: Type.Optional(TranscodeProfileIdSchema),
		target: Type.Optional(
			Type.Union([
				Type.Literal("file"),
				Type.Literal("media-source"),
				Type.Literal("hls"),
			]),
		),
	},
	{ additionalProperties: false },
);
export const CompatibilityInspectionSchema = Type.Object(
	{
		...identity,
		descriptionId: Type.String({ pattern: "^[a-f0-9]{64}$" }),
		container: nullableString,
		video: Type.Union([stream, Type.Null()]),
		audio: Type.Union([stream, Type.Null()]),
		multipleTracks: Type.Boolean(),
		audioTracks: Type.Array(stream),
		selectedAudioTracks: Type.Array(stream),
		queries: Type.Array(query, { maxItems: 1024 }),
		output: Type.Union([outputDescription, Type.Null()]),
	},
	{ additionalProperties: false },
);
export const CompatibilityCheckRequestSchema = Type.Object(
	{
		sourceVersion: SourceVersionSchema,
		descriptionId: Type.String({ pattern: "^[a-f0-9]{64}$" }),
		audioStreamIndices: Type.Optional(AudioStreamSelectionSchema),
		output: Type.Union([CompatibilityOutputRequestSchema, Type.Null()]),
		evidence: CompatibilityEvidenceListSchema,
	},
	{ additionalProperties: false },
);
const combinations = Type.Object(
	{
		"copy-copy": CompatibilityStatusSchema,
		"copy-encode": CompatibilityStatusSchema,
		"encode-copy": CompatibilityStatusSchema,
		"encode-encode": CompatibilityStatusSchema,
	},
	{ additionalProperties: false },
);
const outputResult = Type.Object(
	{
		profileId: TranscodeProfileIdSchema,
		target: Type.Union([
			Type.Literal("file"),
			Type.Literal("media-source"),
			Type.Literal("hls"),
		]),
		profileFingerprint: Type.String({ pattern: "^[a-f0-9]{64}$" }),
		copyVideo: CompatibilityStatusSchema,
		copyAudio: CompatibilityStatusSchema,
		combinations,
		audioTracks: Type.Array(
			Type.Object(
				{
					streamIndex: Type.Integer({ minimum: 0 }),
					copyAudio: CompatibilityStatusSchema,
					combinations,
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
export const CompatibilityResultSchema = Type.Object(
	{
		...identity,
		direct: decision,
		video: decision,
		audio: decision,
		container: decision,
		selectedVideo: Type.Union([stream, Type.Null()]),
		selectedAudio: Type.Union([stream, Type.Null()]),
		selectedAudioTracks: Type.Array(stream),
		audioTracks: Type.Array(Type.Object({ stream, compatibility: decision })),
		output: Type.Union([outputResult, Type.Null()]),
		warnings: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 16 }),
	},
	{ additionalProperties: false },
);
