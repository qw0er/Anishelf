import type { ErrorCode } from "../errors.js";
import type {
	DirectoryEntry,
	FileEntry,
	LibraryIssue,
	ScanState,
} from "./library.js";

// Explicit DTOs exclude internal filesystem paths and index maps.
export type DirectoryDto = Omit<DirectoryEntry, "relativePath">;
export type FileDto = Omit<FileEntry, "relativePath">;
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
