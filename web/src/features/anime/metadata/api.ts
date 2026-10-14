import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	IdentificationStatusResponse,
	MetadataAiringResponse,
	MetadataDetailsResponse,
	MetadataRelationsResponse,
	MetadataSearchResponse,
} from "../../../shared/api/contracts.js";

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
export const getIdentificationStatus = (
	options?: RequestOptions,
): Promise<IdentificationStatusResponse> =>
	request("/api/anime/identification", "GET", options);

export const getAiring = (
	provider: string,
	id: string,
	page: number,
	options?: RequestOptions,
): Promise<MetadataAiringResponse> =>
	request(
		`/api/metadata/${encodeURIComponent(provider)}/${encodeURIComponent(id)}/airing?perPage=25&page=${page}`,
		"GET",
		options,
	);
