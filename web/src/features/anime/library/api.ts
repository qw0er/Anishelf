import { type RequestOptions, request } from "../../../shared/api/client.js";
import type { AnimeLibraryResponse } from "../../../shared/api/contracts.js";

export interface LibraryFilters {
	scope?: "local" | "all";
	viewingStatus?:
		| "all"
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
export function libraryFilters(params: URLSearchParams): LibraryFilters {
	const year = params.get("year") ?? "";
	const page = params.get("page") ?? "1";
	const availability = params.get("availability");
	const query = params.get("query")?.trim().slice(0, 200);
	const format = params.get("format")?.slice(0, 50);
	const requestedViewingStatus = params.get("viewingStatus");
	const viewingStatus =
		requestedViewingStatus === "all"
			? "all"
			: [
						"CURRENT",
						"PLANNING",
						"COMPLETED",
						"PAUSED",
						"DROPPED",
						"REPEATING",
						"untracked",
					].includes(requestedViewingStatus ?? "CURRENT")
				? (requestedViewingStatus ?? "CURRENT")
				: "CURRENT";
	return {
		...(params.get("scope") === "all" ? { scope: "all" as const } : {}),
		viewingStatus: viewingStatus as NonNullable<
			LibraryFilters["viewingStatus"]
		>,
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
export function librarySearch(filters: LibraryFilters): string {
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
export function getAnimeLibrary(
	filters: LibraryFilters,
	generation: string,
	options?: RequestOptions,
): Promise<AnimeLibraryResponse> {
	const params = new URLSearchParams(librarySearch(filters));
	if (filters.viewingStatus === "all") params.delete("viewingStatus");
	params.set("perPage", "24");
	params.set("generation", generation);
	return request(`/api/anime/library?${params}`, "GET", options);
}
