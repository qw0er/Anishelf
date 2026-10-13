import { type RequestOptions, request } from "../../shared/api/client.js";
import type {
	CatalogConfirmationRequest,
	CatalogConfirmationResponse,
	CatalogDetailResponse,
	CatalogListResponse,
	CatalogPreviewRequest,
	CatalogPreviewResponse,
	CatalogReviewItem,
	CatalogReviewResponse,
	CatalogSourceResponse,
	IdentificationStatusResponse,
	MetadataDetailsResponse,
	MetadataRelationsResponse,
	MetadataSearchResponse,
} from "../../shared/api/contracts.js";

export interface CatalogFilters {
	query?: string;
	format?: string;
	year?: string;
	availability?: "available" | "unavailable";
	sort: "title" | "recent";
	page: number;
}
export function catalogFilters(params: URLSearchParams): CatalogFilters {
	const year = params.get("year") ?? "";
	const page = params.get("page") ?? "1";
	const availability = params.get("availability");
	const query = params.get("query")?.trim().slice(0, 200);
	const format = params.get("format")?.slice(0, 50);
	return {
		...(query ? { query } : {}),
		...(format ? { format } : {}),
		...(/^[1-9][0-9]{0,3}$/.test(year) ? { year } : {}),
		...(availability === "available" || availability === "unavailable"
			? { availability }
			: {}),
		sort: params.get("sort") === "recent" ? "recent" : "title",
		page: /^[1-9][0-9]{0,4}$/.test(page) ? Number(page) : 1,
	};
}
export function catalogSearch(filters: CatalogFilters): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(filters)) {
		if (
			(key === "page" && value === 1) ||
			(key === "sort" && value === "title")
		)
			continue;
		if (value) params.set(key, String(value));
	}
	return params.toString();
}
export function getCatalog(
	filters: CatalogFilters,
	options?: RequestOptions,
): Promise<CatalogListResponse> {
	const params = new URLSearchParams(catalogSearch(filters));
	params.set("perPage", "24");
	return request(`/api/catalog/works?${params}`, "GET", options);
}
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
export function getRelations(
	provider: string,
	id: string,
	page: number,
	options?: RequestOptions,
): Promise<MetadataRelationsResponse> {
	return request(
		`/api/metadata/${encodeURIComponent(provider)}/${encodeURIComponent(id)}/relations?cachedOnly=true&perPage=25&page=${page}`,
		"GET",
		options,
	);
}

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
export const searchMetadata = (
	query: string,
	page: number,
	options?: RequestOptions,
): Promise<MetadataSearchResponse> =>
	request(
		`/api/metadata/search?${new URLSearchParams({ query, page: String(page), perPage: "10" })}`,
		"GET",
		options,
	);
export const metadataDetail = (
	provider: string,
	id: string,
	options?: RequestOptions,
): Promise<MetadataDetailsResponse> =>
	request(
		`/api/metadata/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`,
		"GET",
		options,
	);
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
export const getIdentificationStatus = (
	options?: RequestOptions,
): Promise<IdentificationStatusResponse> =>
	request("/api/anime/identification", "GET", options);

export const getSource = (
	id: string,
	options?: RequestOptions,
): Promise<CatalogSourceResponse> =>
	request(`/api/catalog/sources/${encodeURIComponent(id)}`, "GET", options);
