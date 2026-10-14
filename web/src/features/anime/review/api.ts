import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	CatalogConfirmationRequest,
	CatalogConfirmationResponse,
	CatalogPreviewRequest,
	CatalogPreviewResponse,
	CatalogReviewItem,
	CatalogReviewResponse,
} from "../../../shared/api/contracts.js";

export const getReviews = (
	decision: string,
	page: number,
	options?: RequestOptions,
): Promise<CatalogReviewResponse> =>
	request(
		`/api/catalog/reviews?${new URLSearchParams({ decision, page: String(page), perPage: "20" })}`,
		"GET",
		options,
	);
export const getReview = (
	id: string,
	options?: RequestOptions,
): Promise<CatalogReviewItem> =>
	request(`/api/catalog/reviews/${encodeURIComponent(id)}`, "GET", options);
export const previewMapping = (
	input: CatalogPreviewRequest,
): Promise<CatalogPreviewResponse> =>
	request("/api/catalog/previews", "POST", {}, input);
export const confirmMapping = (
	input: CatalogConfirmationRequest,
): Promise<CatalogConfirmationResponse> =>
	request("/api/catalog/confirmations", "POST", {}, input);
export const decideReview = (
	id: string,
	revision: number,
	reason: string,
	remove: boolean,
): Promise<CatalogReviewItem> =>
	request(
		`/api/catalog/reviews/${encodeURIComponent(id)}/${remove ? "remove" : "reject"}`,
		"POST",
		{},
		{ revision, reason },
	);
