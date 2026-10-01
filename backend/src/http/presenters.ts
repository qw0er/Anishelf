import type { PersistentSettings } from "../config/model.js";
import type {
	DirectoryInfo,
	DirectoryListing,
	FileInfo,
	LibraryStatus,
	ResourceInfo,
} from "../library/model.js";
import type { LibraryIssue, ScanState } from "../library/scan-state.js";
import type {
	DirectoryDto,
	DirectoryResponse,
	FileDto,
	LibraryIssueDto,
	LibraryResponse,
	ResourceDto,
	ScanStateDto,
	SettingsResponse,
} from "./contracts.js";

/** Explicit projections keep backend additions out of public JSON responses. */
function directoryDto(directory: DirectoryInfo): DirectoryDto {
	return {
		kind: "directory",
		id: directory.id,
		parentId: directory.parentId,
		name: directory.name,
	};
}

export function fileDto(file: FileInfo): FileDto {
	return {
		kind: "file",
		id: file.id,
		parentId: file.parentId,
		name: file.name,
		sizeBytes: file.sizeBytes,
		modifiedAt: file.modifiedAt,
		mimeType: file.mimeType,
	};
}

function resourceDto(resource: ResourceInfo): ResourceDto {
	return resource.kind === "directory"
		? directoryDto(resource)
		: fileDto(resource);
}

function libraryIssueDto(issue: LibraryIssue): LibraryIssueDto {
	return { code: issue.code, message: issue.message };
}

export function scanStateDto(state: ScanState): ScanStateDto {
	const fields = {
		id: state.id,
		startedAt: state.startedAt,
		visitedCount: state.visitedCount,
		matchedCount: state.matchedCount,
		warnings: {
			count: state.warnings.count,
			messages: [...state.warnings.messages],
		},
	};
	switch (state.status) {
		case "running":
			return { ...fields, status: "running", finishedAt: null };
		case "failed":
			return {
				...fields,
				status: "failed",
				finishedAt: state.finishedAt,
				error: libraryIssueDto(state.error),
			};
		case "completed":
		case "cancelled":
			return { ...fields, status: state.status, finishedAt: state.finishedAt };
	}
}

export function libraryResponse(status: LibraryStatus): LibraryResponse {
	return {
		ready: status.ready,
		revision: status.revision,
		scan: status.scan ? scanStateDto(status.scan) : null,
		error: status.error ? libraryIssueDto(status.error) : null,
		stale: status.stale,
	};
}

export function directoryResponse(
	listing: DirectoryListing,
): DirectoryResponse {
	return {
		directory: directoryDto(listing.directory),
		children: listing.children.map(resourceDto),
	};
}

export function settingsResponse(
	settings: Readonly<PersistentSettings>,
): SettingsResponse {
	return { resourceRoot: settings.resourceRoot };
}
