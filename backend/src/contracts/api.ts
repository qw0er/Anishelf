import type { ErrorCode } from "../errors.js";
import type { PersistentSettings } from "./config.js";
import type {
	LibraryIssue,
	ResourceId,
	ScanState,
	Timestamp,
} from "./library.js";

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
	modifiedAt: Timestamp;
	mimeType: string;
}
export type ResourceDto = DirectoryDto | FileDto;

export interface LibraryResponse {
	ready: boolean;
	revision: number;
	scan: ScanState | null;
	error: LibraryIssue | null;
	/** A failed rescan leaves the previous snapshot available but potentially stale. */
	stale: boolean;
}

export interface ScanResponse {
	scan: ScanState;
}

export type SettingsResponse = PersistentSettings;

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
