import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	AnimeLibraryResponse,
	CatalogDetailResponse,
	CatalogFileReviewsResponse,
	CatalogListResponse,
	CatalogReviewResponse,
	CatalogSourceResponse,
} from "../../../shared/api/contracts.js";

export interface CatalogFilters {
	scope?: "local" | "all";
	viewingStatus?:
		| "CURRENT"
		| "PLANNING"
		| "COMPLETED"
		| "PAUSED"
		| "DROPPED"
		| "REPEATING"
		| "untracked";
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
	const viewingStatus = params.get("viewingStatus");
	return {
		...(params.get("scope") === "all" ? { scope: "all" as const } : {}),
		...([
			"CURRENT",
			"PLANNING",
			"COMPLETED",
			"PAUSED",
			"DROPPED",
			"REPEATING",
			"untracked",
		].includes(viewingStatus ?? "")
			? {
					viewingStatus: viewingStatus as NonNullable<
						CatalogFilters["viewingStatus"]
					>,
				}
			: {}),
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
	identity?: { accountId: number | null; generation: string },
): Promise<AnimeLibraryResponse | CatalogListResponse> {
	const params = new URLSearchParams(catalogSearch(filters));
	params.set("perPage", "24");
	if (identity) {
		params.set("generation", identity.generation);
		return request(`/api/anime/library?${params}`, "GET", options);
	}
	params.delete("scope");
	params.delete("viewingStatus");
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
