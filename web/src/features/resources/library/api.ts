import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	DirectoryResponse,
	DirectorySearchResponse,
	LibraryResponse,
	ResourceCommand,
	ResourceCommandResult,
	ResourceId,
	ScanResponse,
} from "../../../shared/api/contracts.js";

export function getLibrary(options?: RequestOptions): Promise<LibraryResponse> {
	return request<LibraryResponse>("/api/library", "GET", options);
}

export function searchDirectory(
	id: ResourceId,
	query: string,
	options?: RequestOptions,
): Promise<DirectorySearchResponse> {
	return request<DirectorySearchResponse>(
		`/api/directories/${encodeURIComponent(id)}/search?${new URLSearchParams({ q: query })}`,
		"GET",
		options,
	);
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

export function executeResource(
	input: ResourceCommand,
): Promise<ResourceCommandResult> {
	return request("/api/resources/execute", "POST", {}, input);
}
