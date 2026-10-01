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
