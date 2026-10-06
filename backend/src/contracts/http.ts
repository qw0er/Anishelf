import type { Static } from "typebox";
import type * as schemas from "./schemas/index.js";

// Public JSON types are derived from the same schemas used by Fastify.
export type ResourceId = Static<typeof schemas.ResourceIdSchema>;
export type ScanWarningSummaryDto = Static<
	typeof schemas.ScanWarningSummaryDtoSchema
>;
export type LibraryIssueDto = Static<typeof schemas.LibraryIssueDtoSchema>;
export type ScanStateDto = Static<typeof schemas.ScanStateDtoSchema>;
export type DirectoryDto = Static<typeof schemas.DirectoryDtoSchema>;
export type FileDto = Static<typeof schemas.FileDtoSchema>;
export type ResourceDto = Static<typeof schemas.ResourceDtoSchema>;
export type LibraryResponse = Static<typeof schemas.LibraryResponseSchema>;
export type ScanResponse = Static<typeof schemas.ScanResponseSchema>;
export type SettingsResponse = Static<typeof schemas.SettingsResponseSchema>;
export type UpdateSettingsRequest = Static<
	typeof schemas.UpdateSettingsRequestSchema
>;
export type DirectoryResponse = Static<typeof schemas.DirectoryResponseSchema>;
export type FileResponse = Static<typeof schemas.FileResponseSchema>;
export type ApiErrorResponse = Static<typeof schemas.ApiErrorResponseSchema>;
export type PlaybackProgressDto = Static<
	typeof schemas.PlaybackProgressDtoSchema
>;
export type OpenPlaybackRequest = Static<
	typeof schemas.OpenPlaybackRequestSchema
>;
export type PlaybackSessionResponse = Static<
	typeof schemas.PlaybackSessionResponseSchema
>;
export type PlaybackPlanDto = Static<typeof schemas.PlaybackPlanSchema>;
export type PreparationTaskResponse = Static<
	typeof schemas.PreparationTaskSchema
>;
export type PreparationStartResponse = Static<
	typeof schemas.PreparationStartResponseSchema
>;
export type PreparationListResponse = Static<
	typeof schemas.PreparationListResponseSchema
>;
export type SavePlaybackProgressRequest = Static<
	typeof schemas.SavePlaybackProgressRequestSchema
>;
export type SavePlaybackProgressResponse = Static<
	typeof schemas.SavePlaybackProgressResponseSchema
>;
export type HistoryResponse = Static<typeof schemas.HistoryResponseSchema>;
export type SubtitleDiscoveryResponse = Static<
	typeof schemas.SubtitleDiscoveryResponseSchema
>;

export type SubtitlePreparationResponse = Static<
	typeof schemas.SubtitlePreparationResponseSchema
>;

export type CompatibilityInspection = Static<
	typeof schemas.CompatibilityInspectionSchema
>;
export type CompatibilityCheckRequest = Static<
	typeof schemas.CompatibilityCheckRequestSchema
>;
export type CompatibilityResult = Static<
	typeof schemas.CompatibilityResultSchema
>;
export type CompatibilityQuery = CompatibilityInspection["queries"][number];
export type CompatibilityEvidence =
	CompatibilityCheckRequest["evidence"][number];
export type CompatibilityVideoStream = Static<
	typeof schemas.VideoStreamDescriptionSchema
>;
export type CompatibilityAudioStream = Static<
	typeof schemas.AudioStreamDescriptionSchema
>;
export type CompatibilityStream =
	| CompatibilityVideoStream
	| CompatibilityAudioStream;

export type TranscodeProfileCatalog = Static<
	typeof schemas.TranscodeProfileCatalogSchema
>;
export type SelectTranscodeProfileRequest = Static<
	typeof schemas.SelectTranscodeProfileSchema
>;

export type MediaTimeline = Static<typeof schemas.MediaTimelineSchema>;
export type FilePlaybackResource = Static<
	typeof schemas.FilePlaybackResourceSchema
>;
export type PlaybackOptionsRequest = Static<
	typeof schemas.PlaybackOptionsRequestSchema
>;
export type PlaybackOptionsResponse = Static<
	typeof schemas.PlaybackOptionsResponseSchema
>;
export type PlaybackSelectionRequest = Static<
	typeof schemas.PlaybackSelectionRequestSchema
>;
export type PlaybackSelectionResponse = Static<
	typeof schemas.PlaybackSelectionResponseSchema
>;

export type PreparationSummaryResponse = Static<
	typeof schemas.PreparationSummaryResponseSchema
>;
