import { Type } from "typebox";
import { playbackSelectionConstraints } from "../defaults.js";
import { ResourceIdSchema } from "./common.js";
import {
	AudioStreamSelectionSchema,
	CompatibilityCheckRequestSchema,
	CompatibilityInspectionSchema,
	CompatibilityResultSchema,
} from "./compatibility.js";
import { PlaybackPlanSchema, SourceVersionSchema } from "./playback.js";

const intent = {
	fileId: ResourceIdSchema,
	sourceVersion: Type.Optional(SourceVersionSchema),
	audioStreamIndices: Type.Optional(AudioStreamSelectionSchema),
	tryOriginal: Type.Optional(Type.Boolean()),
	failedResourceIds: Type.Optional(
		Type.Array(ResourceIdSchema, {
			maxItems: playbackSelectionConstraints.maximumFailedResources,
			uniqueItems: true,
		}),
	),
};
export const PlaybackOptionsRequestSchema = Type.Object(intent, {
	additionalProperties: false,
});
export const PlaybackOptionsResponseSchema = Type.Object(
	{
		original: CompatibilityInspectionSchema,
		candidates: Type.Array(
			Type.Object(
				{
					taskId: ResourceIdSchema,
					description: CompatibilityInspectionSchema,
				},
				{ additionalProperties: false },
			),
			{ maxItems: playbackSelectionConstraints.maximumCandidates },
		),
	},
	{ additionalProperties: false },
);
export const PlaybackSelectionRequestSchema = Type.Object(
	{
		...intent,
		original: Type.Optional(CompatibilityCheckRequestSchema),
		candidates: Type.Array(
			Type.Object(
				{ taskId: ResourceIdSchema, check: CompatibilityCheckRequestSchema },
				{ additionalProperties: false },
			),
			{ maxItems: playbackSelectionConstraints.maximumCandidates },
		),
	},
	{ additionalProperties: false },
);
export const PlaybackSelectionResponseSchema = Type.Object(
	{
		sourceVersion: SourceVersionSchema,
		compatibility: Type.Union([CompatibilityResultSchema, Type.Null()]),
		plan: PlaybackPlanSchema,
		pending: Type.Boolean(),
	},
	{ additionalProperties: false },
);
