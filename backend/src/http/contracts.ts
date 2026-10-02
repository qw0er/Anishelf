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
export type SavePlaybackProgressRequest = Static<
	typeof schemas.SavePlaybackProgressRequestSchema
>;
export type SavePlaybackProgressResponse = Static<
	typeof schemas.SavePlaybackProgressResponseSchema
>;
export type ContinueWatchingResponse = Static<
	typeof schemas.ContinueWatchingResponseSchema
>;
export type SubtitleDiscoveryResponse = Static<
	typeof schemas.SubtitleDiscoveryResponseSchema
>;
