import type { Static } from "typebox";
import type * as schemas from "./schemas/index.js";

// Public JSON types are derived from the same schemas used by Fastify.
export type SubscriptionView = Static<typeof schemas.SubscriptionViewSchema>;
export type SubscriptionPreview = Static<
	typeof schemas.SubscriptionPreviewSchema
>;
export type SubscriptionPreviewInput = Static<
	typeof schemas.SubscriptionPreviewInputSchema
>;
export type QbittorrentConnectionSettings = Static<
	typeof schemas.QbittorrentConnectionSettingsSchema
>;
export type QbittorrentConnectionUpdate = Static<
	typeof schemas.QbittorrentConnectionUpdateSchema
>;
export type QbittorrentConnectionProbe = Static<
	typeof schemas.QbittorrentConnectionProbeSchema
>;
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
export type ChaptersResponse = Static<typeof schemas.ChaptersResponseSchema>;
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

export type MetadataSearchResponse = Static<
	typeof schemas.MetadataSearchResponseSchema
>;
export type MetadataDetailsResponse = Static<
	typeof schemas.MetadataDetailsResponseSchema
>;
export type MetadataRelationsResponse = Static<
	typeof schemas.MetadataRelationsResponseSchema
>;
export type MetadataAiringResponse = Static<
	typeof schemas.MetadataAiringResponseSchema
>;
export type MetadataArtworkResponse = Static<
	typeof schemas.MetadataArtworkResponseSchema
>;

export type CatalogSourceResponse = Static<typeof schemas.CatalogSourceSchema>;
export type CatalogListResponse = Static<typeof schemas.CatalogListSchema>;
export type LocalWorkDetailResponse = Static<
	typeof schemas.LocalWorkDetailSchema
>;
export type CatalogReviewResponse = Static<
	typeof schemas.CatalogReviewListSchema
>;
export type CatalogPreviewRequest = Static<
	typeof schemas.CatalogPreviewRequestSchema
>;
export type CatalogPreviewResponse = Static<
	typeof schemas.CatalogPreviewSchema
>;
export type CatalogConfirmationRequest = Static<
	typeof schemas.CatalogConfirmationRequestSchema
>;
export type CatalogConfirmationResponse = Static<
	typeof schemas.CatalogConfirmationSchema
>;

export type CatalogDecisionRequest = Static<
	typeof schemas.CatalogDecisionRequestSchema
>;
export type CatalogEpisodeEditRequest = Static<
	typeof schemas.CatalogEpisodeEditSchema
>;
export type CatalogRefreshRequest = Static<typeof schemas.CatalogRefreshSchema>;
export type CatalogReviewItem = Static<typeof schemas.CatalogReviewSchema>;
export type CatalogEpisodeResponse = Static<
	typeof schemas.CatalogEpisodeSchema
>;

export type IdentificationStatusResponse = Static<
	typeof schemas.IdentificationStatusSchema
>;

export type CatalogFileReviewsResponse = Static<
	typeof schemas.CatalogFileReviewsSchema
>;

export type AuthSessionResponse = Static<
	typeof schemas.AuthSessionResponseSchema
>;
export type MediaAccessLinkResponse = Static<
	typeof schemas.MediaAccessLinkResponseSchema
>;

export type TrackingAccountResponse = Static<
	typeof schemas.TrackingStatusSchema
>;
export type TrackingPreviewResponse = Static<
	typeof schemas.TrackingPreviewSchema
>;

export type AnimeLibraryResponse = Static<typeof schemas.AnimeLibrarySchema>;
export type TrackingListResponse = Static<typeof schemas.TrackingListSchema>;
export type TrackingEntryResponse = Static<typeof schemas.TrackingEntrySchema>;

export type TrackingOperationResponse = Static<
	typeof import("./schemas/tracking-update.js").TrackingOperationSchema
>;
export type TrackingOperationsResponse = Static<
	typeof import("./schemas/tracking-update.js").TrackingOperationsSchema
>;
export type TrackingUpdateRequest = Static<
	typeof import("./schemas/tracking-update.js").TrackingUpdateSchema
>;

export type TrackingEpisodeTargetResponse = NonNullable<
	TrackingEpisodeResolutionResponse["target"]
>;
export type TrackingEpisodeCommandRequest = Static<
	typeof import("./schemas/tracking-update.js").TrackingEpisodeCommandSchema
>;

export type TrackingEpisodeResolutionResponse = Static<
	typeof import("./schemas/tracking-update.js").TrackingEpisodeResolutionSchema
>;

export type DownloadSettings = Static<
	typeof import("./schemas/downloads.js").DownloadSettingsSchema
>;
export type DownloadActivity = Static<
	typeof import("./schemas/downloads.js").DownloadActivitySchema
>;

export type AnimeDetailResponse = Static<typeof schemas.AnimeDetailSchema>;
