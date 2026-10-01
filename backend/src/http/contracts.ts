import type { ErrorCode } from "../errors.js";

// Public JSON shapes only. Backend models and runtime state live in their owners.
export type ResourceId = string;

export interface ScanWarningSummaryDto {
	count: number;
	messages: readonly string[];
}

interface ScanStateFieldsDto {
	id: string;
	startedAt: string;
	visitedCount: number;
	matchedCount: number;
	warnings: ScanWarningSummaryDto;
}

export interface LibraryIssueDto {
	code:
		| "RESOURCE_ROOT_NOT_CONFIGURED"
		| "RESOURCE_ROOT_UNAVAILABLE"
		| "SCAN_FAILED";
	message: string;
}

export type ScanStateDto =
	| (ScanStateFieldsDto & { status: "running"; finishedAt: null })
	| (ScanStateFieldsDto & { status: "completed"; finishedAt: string })
	| (ScanStateFieldsDto & {
			status: "failed";
			finishedAt: string;
			error: LibraryIssueDto;
	  })
	| (ScanStateFieldsDto & { status: "cancelled"; finishedAt: string });

export interface DirectoryDto {
	kind: "directory";
	id: ResourceId;
	parentId: ResourceId | null;
	name: string;
}
export interface FileDto {
	kind: "file";
	id: ResourceId;
	parentId: ResourceId;
	name: string;
	sizeBytes: number;
	modifiedAt: string;
	mimeType: string;
}
export type ResourceDto = DirectoryDto | FileDto;

export interface LibraryResponse {
	ready: boolean;
	revision: number;
	scan: ScanStateDto | null;
	error: LibraryIssueDto | null;
	/** A failed rescan leaves the previous snapshot available but potentially stale. */
	stale: boolean;
}

export interface ScanResponse {
	scan: ScanStateDto;
}

export interface SettingsResponse {
	resourceRoot: string | null;
}

export interface UpdateSettingsRequest {
	resourceRoot: string;
}

export interface DirectoryResponse {
	directory: DirectoryDto;
	children: readonly ResourceDto[];
}

/** Returned after checking current file accessibility. */
export interface FileResponse {
	file: FileDto;
	playbackUrl: string;
}

export interface ApiErrorResponse {
	error: {
		code: ErrorCode;
		message: string;
		requestId: string;
	};
}

export interface PlaybackProgressDto {
	positionMs: number;
	durationMs: number | null;
	lastViewedAtMs: number | null;
	revision: number;
	generation: number;
	lastSequence: number;
}

export interface OpenPlaybackRequest {
	fileId: ResourceId;
}

export interface PlaybackSessionResponse {
	token: string;
	generation: number;
	sourceVersion: string;
	file: FileDto;
	plan: { mode: "direct"; playbackUrl: string };
	progress: PlaybackProgressDto;
}

/** The session token is supplied in the route, not trusted from the body. */
export interface SavePlaybackProgressRequest {
	generation: number;
	sourceVersion: string;
	sequence: number;
	positionMs: number;
	durationMs: number | null;
}

export interface SavePlaybackProgressResponse {
	status: "saved" | "duplicate";
	progress: PlaybackProgressDto;
}

export interface StartOverPlaybackRequest {
	generation: number;
	/** Stable across retries of the same reset; independent of HTTP tracing IDs. */
	requestId: string;
}

export interface StartOverPlaybackResponse {
	progress: PlaybackProgressDto;
}

export interface ContinueWatchingResponse {
	availability: "unknown" | "checked";
	items: { file: FileDto; progress: PlaybackProgressDto }[];
}
