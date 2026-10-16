import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	CatalogDetailResponse,
	CatalogFileReviewsResponse,
	CatalogReviewResponse,
	CatalogSourceResponse,
} from "../../../shared/api/contracts.js";

export function getWork(
	id: string,
	options?: RequestOptions,
): Promise<CatalogDetailResponse> {
	return request(
		`/api/catalog/works/${encodeURIComponent(id)}`,
		"GET",
		options,
	);
}
export function refreshWork(
	id: string,
	revision: number,
	options?: RequestOptions,
): Promise<CatalogDetailResponse> {
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
