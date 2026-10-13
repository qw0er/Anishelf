import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	CompatibilityCheckRequest,
	PreparationListResponse,
	PreparationStartResponse,
	PreparationSummaryResponse,
	PreparationTaskResponse,
} from "../../../shared/api/contracts.js";

export function getPreparations(
	options?: RequestOptions,
	more = false,
): Promise<PreparationListResponse> {
	return request(
		`/api/preparations?summary=true${more ? "&more=true" : ""}`,
		"GET",
		options,
	);
}
export function createPreparation(
	fileId: string,
	body: CompatibilityCheckRequest,
	options?: RequestOptions,
): Promise<PreparationStartResponse> {
	return request(
		`/api/files/${encodeURIComponent(fileId)}/preparations`,
		"POST",
		options,
		body,
	);
}
export function cancelPreparation(
	id: string,
	options?: RequestOptions,
): Promise<PreparationTaskResponse> {
	return request(
		`/api/preparations/${encodeURIComponent(id)}/cancel`,
		"POST",
		options,
		{},
	);
}
export function retryPreparation(
	id: string,
	body: CompatibilityCheckRequest,
	options?: RequestOptions,
): Promise<PreparationTaskResponse> {
	return request(
		`/api/preparations/${encodeURIComponent(id)}/retry`,
		"POST",
		options,
		body,
	);
}
export function deletePreparedMedia(
	id: string,
	options?: RequestOptions,
): Promise<void> {
	return request(
		`/api/prepared-media/${encodeURIComponent(id)}`,
		"DELETE",
		options,
	);
}

export function getFilePreparations(
	fileId: string,
	options?: RequestOptions,
): Promise<PreparationListResponse> {
	return request(
		`/api/preparations?${new URLSearchParams({ fileId })}`,
		"GET",
		options,
	);
}

export function getPreparationSummaries(
	fileIds: string[],
	options?: RequestOptions,
): Promise<PreparationSummaryResponse> {
	return request("/api/preparations/summaries", "POST", options, { fileIds });
}
