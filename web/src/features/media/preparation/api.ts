import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	PreparationListResponse,
	PreparationRequest,
	PreparationStartResponse,
	PreparationSummaryResponse,
	PreparationTaskResponse,
	PreparedMediaDeleteResponse,
	PreparedMediaList,
	PreparedMediaQuery,
} from "../../../shared/api/contracts.js";

export function getPreparations(
	options?: RequestOptions,
	inactiveLimit = 0,
): Promise<PreparationListResponse> {
	return request(
		`/api/preparations?${new URLSearchParams({
			summary: "true",
			inactiveLimit: String(inactiveLimit),
		})}`,
		"GET",
		options,
	);
}
export function createPreparation(
	fileId: string,
	body: PreparationRequest,
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
	body: PreparationRequest | Record<string, never>,
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

export function getPreparedMedia(
	input: PreparedMediaQuery,
	options?: RequestOptions,
): Promise<PreparedMediaList> {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(input))
		if (value !== undefined && value !== "") query.set(key, String(value));
	return request(`/api/prepared-media?${query}`, "GET", options);
}
export function deletePreparedMediaBatch(
	ids: string[],
	options?: RequestOptions,
): Promise<PreparedMediaDeleteResponse> {
	return request("/api/prepared-media/delete", "POST", options, { ids });
}

export function getPreparationSource(
	fileId: string,
	options?: RequestOptions,
	sourceVersion?: string,
): Promise<import("../../../shared/api/contracts.js").PlaybackSource> {
	return request(
		`/api/files/${encodeURIComponent(fileId)}/preparation-source${sourceVersion ? `?${new URLSearchParams({ sourceVersion })}` : ""}`,
		"GET",
		options,
	);
}
