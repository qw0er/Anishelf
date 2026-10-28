import { Type } from "typebox";
import { playbackSelectionConstraints } from "../defaults.js";
import { ResourceIdSchema } from "./common.js";
import {
	AudioStreamDescriptionSchema,
	CompatibilityDecisionSchema,
	CompatibilityEvidenceListSchema,
	MediaCapabilityQuerySchema,
	VideoStreamDescriptionSchema,
} from "./compatibility.js";
import { FilePlaybackResourceSchema, MediaTimelineSchema } from "./media.js";
import { SourceVersionSchema } from "./playback.js";
import { TranscodeProfileIdSchema } from "./transcode-profiles.js";

const object = { additionalProperties: false } as const;
const index = Type.Integer({ minimum: 0 });
const nullableIndex = Type.Union([index, Type.Null()]);
const text = Type.Union([Type.String({ maxLength: 256 }), Type.Null()]);
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const PlaybackSourceSchema = Type.Object(
	{
		fileId: ResourceIdSchema,
		sourceVersion: SourceVersionSchema,
		audioTracks: Type.Array(AudioStreamDescriptionSchema, { maxItems: 128 }),
		defaultAudioStreamIndex: nullableIndex,
	},
	object,
);
export const MediaAssetSchema = Type.Object(
	{
		id: ResourceIdSchema,
		revision: digest,
		kind: Type.Union([Type.Literal("original"), Type.Literal("prepared")]),
		inspection: Type.Union([
			Type.Literal("complete"),
			Type.Literal("unavailable"),
		]),
		profileId: Type.Union([TranscodeProfileIdSchema, Type.Null()]),
		container: text,
		video: Type.Union([VideoStreamDescriptionSchema, Type.Null()]),
		audioTracks: Type.Array(
			Type.Object(
				{ stream: AudioStreamDescriptionSchema, sourceStreamIndex: index },
				object,
			),
			{ maxItems: 128 },
		),
		defaultAudioStreamIndex: nullableIndex,
		durationMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
		sizeBytes: Type.Integer({ minimum: 0 }),
		mimeType: Type.String({ maxLength: 256 }),
		timeline: MediaTimelineSchema,
	},
	object,
);
const audio = Type.Union([
	Type.Object(
		{ streamIndex: index, sourceStreamIndex: index, position: index },
		object,
	),
	Type.Null(),
]);
export const AssetCompatibilitySchema = Type.Object(
	{
		overall: CompatibilityDecisionSchema,
		container: CompatibilityDecisionSchema,
		video: CompatibilityDecisionSchema,
		audio: CompatibilityDecisionSchema,
		warnings: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 16 }),
	},
	object,
);
export const AssetInspectionSchema = Type.Object(
	{
		asset: MediaAssetSchema,
		descriptionId: digest,
		audio,
		queries: Type.Array(MediaCapabilityQuerySchema, { maxItems: 4 }),
	},
	object,
);
const intent = {
	fileId: ResourceIdSchema,
	sourceVersion: Type.Optional(SourceVersionSchema),
	audioStreamIndex: Type.Optional(nullableIndex),
	assetId: Type.Optional(ResourceIdSchema),
	allowUnverified: Type.Optional(Type.Boolean()),
	canSelectAudio: Type.Boolean(),
	failedResourceIds: Type.Optional(
		Type.Array(ResourceIdSchema, {
			maxItems: playbackSelectionConstraints.maximumFailedResources,
			uniqueItems: true,
		}),
	),
};
export const PlaybackOptionsRequestSchema = Type.Object(intent, object);
const result = {
	source: PlaybackSourceSchema,
	resolvedAudioStreamIndex: nullableIndex,
	pending: Type.Boolean(),
};
export const PlaybackOptionsResponseSchema = Type.Object(
	{
		...result,
		assets: Type.Array(AssetInspectionSchema, {
			maxItems: playbackSelectionConstraints.maximumCandidates,
		}),
	},
	object,
);
export const PlaybackSelectionRequestSchema = Type.Object(
	{
		...intent,
		evidence: Type.Array(
			Type.Object(
				{
					assetId: ResourceIdSchema,
					descriptionId: digest,
					evidence: CompatibilityEvidenceListSchema,
				},
				object,
			),
			{ maxItems: playbackSelectionConstraints.maximumCandidates },
		),
	},
	object,
);
const choice = {
	asset: MediaAssetSchema,
	audio,
	compatibility: AssetCompatibilitySchema,
	unavailableReason: text,
};
export const PlaybackAssetChoiceSchema = Type.Object(choice, object);
export const ActivePlaybackSchema = Type.Object(
	{ ...choice, resource: FilePlaybackResourceSchema },
	object,
);
export const PlaybackSelectionResponseSchema = Type.Object(
	{
		...result,
		choices: Type.Array(PlaybackAssetChoiceSchema, {
			maxItems: playbackSelectionConstraints.maximumCandidates,
		}),
		active: Type.Union([ActivePlaybackSchema, Type.Null()]),
		reason: text,
	},
	object,
);
