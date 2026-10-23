import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	DirectoryResponse,
	LibraryResponse,
	ResourceId,
	ScanResponse,
} from "../../../shared/api/contracts.js";

export function getLibrary(options?: RequestOptions): Promise<LibraryResponse> {
	return request<LibraryResponse>("/api/library", "GET", options);
}

export function startScan(options?: RequestOptions): Promise<ScanResponse> {
	return request<ScanResponse>("/api/library/scan", "POST", options);
}

export function getDirectory(
	id: ResourceId,
	options?: RequestOptions,
): Promise<DirectoryResponse> {
	return request<DirectoryResponse>(
		`/api/directories/${encodeURIComponent(id)}`,
		"GET",
		options,
	);
}
