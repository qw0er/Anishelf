import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../../shared/api/queries.js";
import {
	getIdentificationStatus,
	getRelations,
	metadataDetail,
	searchMetadata,
} from "./api.js";

export const relationsQuery = (provider: string, id: string, page: number) =>
	queryOptions({
		queryKey: ["metadata-relations", provider, id, page],
		queryFn: ({ signal }) =>
			getRelations(provider, id, page, { signal: boundedSignal(signal) }),
	});

export const metadataSearchQuery = (query: string, page: number) =>
	queryOptions({
		queryKey: ["metadata-search", query, page],
		queryFn: ({ signal }) =>
			searchMetadata(query, page, { signal: boundedSignal(signal) }),
	});
export const metadataDetailQuery = (provider: string, id: string) =>
	queryOptions({
		queryKey: ["metadata-detail", provider, id],
		queryFn: ({ signal }) =>
			metadataDetail(provider, id, { signal: boundedSignal(signal) }),
	});

export const identificationQuery = (scope: string) =>
	queryOptions({
		queryKey: ["identification", scope],
		queryFn: ({ signal }) =>
			getIdentificationStatus({ signal: boundedSignal(signal) }),
		staleTime: 0,
		refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
	});
