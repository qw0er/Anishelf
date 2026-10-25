import { workKey } from "@anishelf/backend/contracts/references";
import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	IdentificationStatusResponse,
	MetadataAiringResponse,
	MetadataDetailsResponse,
	MetadataRelationsResponse,
	MetadataSearchResponse,
} from "../../../shared/api/contracts.js";

export function getRelations(
	id: string,
	page: number,
	options?: RequestOptions,
): Promise<MetadataRelationsResponse> {
	return request(
		`/api/metadata/${encodeURIComponent(id)}/relations?cachedOnly=true&perPage=25&page=${page}`,
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
export const metadataDetail = async (
	reference: { id: string; provider?: string; mediaType?: "anime" },
	options?: RequestOptions,
): Promise<MetadataDetailsResponse> => {
	const { id } = reference.provider
		? await resolveMetadataReference(
				workKey({
					provider: reference.provider,
					mediaType: "anime",
					id: reference.id,
				}),
				options,
			)
		: reference;
	return request(`/api/metadata/${encodeURIComponent(id)}`, "GET", options);
};
export const getIdentificationStatus = (
	options?: RequestOptions,
): Promise<IdentificationStatusResponse> =>
	request("/api/anime/identification", "GET", options);

export const getAiring = (
	id: string,
	page: number,
	options?: RequestOptions,
): Promise<MetadataAiringResponse> =>
	request(
		`/api/metadata/${encodeURIComponent(id)}/airing?perPage=25&page=${page}`,
		"GET",
		options,
	);

export const resolveMetadataReference = (
	value: string,
	options?: RequestOptions,
) =>
	request<
		import("../../../shared/api/contracts.js").MetadataDetailsResponse["data"]["reference"]
	>(
		`/api/metadata/reference?${new URLSearchParams({ value })}`,
		"GET",
		options,
	);
