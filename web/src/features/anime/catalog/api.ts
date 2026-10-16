import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	CatalogFileReviewsResponse,
	CatalogReviewResponse,
	CatalogSourceResponse,
	LocalWorkDetailResponse,
} from "../../../shared/api/contracts.js";

export function getLocalWorkDetail(
	id: string,
	options?: RequestOptions,
): Promise<LocalWorkDetailResponse> {
	return request(
		`/api/catalog/works/${encodeURIComponent(id)}`,
		"GET",
		options,
	);
}
export function refreshLocalWorkDetail(
	id: string,
	revision: number,
	options?: RequestOptions,
): Promise<LocalWorkDetailResponse> {
	return request(
		`/api/catalog/works/${encodeURIComponent(id)}/refresh`,
		"POST",
		options,
		{ revision },
	);
}
export const getSource = (
	id: string,
	options?: RequestOptions,
): Promise<CatalogSourceResponse> =>
	request(`/api/catalog/sources/${encodeURIComponent(id)}`, "GET", options);

export const getFileReviews = (
	fileIds: string[],
	options?: RequestOptions,
): Promise<CatalogFileReviewsResponse> =>
	request("/api/catalog/file-reviews", "POST", options, { fileIds });
export const getWorkReviews = (
	workId: string,
	page: number,
	options?: RequestOptions,
): Promise<CatalogReviewResponse> =>
	request(
		`/api/catalog/reviews?${new URLSearchParams({ workId, decision: "pending", page: String(page), perPage: "20" })}`,
		"GET",
		options,
	);
