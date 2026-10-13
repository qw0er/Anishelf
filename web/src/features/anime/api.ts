import { type RequestOptions, request } from "../../shared/api/client.js";
import type {
	CatalogDetailResponse,
	CatalogListResponse,
	MetadataRelationsResponse,
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
