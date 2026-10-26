import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../../shared/api/queries.js";
import {
	getAiring,
	getIdentificationStatus,
	getRelations,
	metadataDetail,
	searchMetadata,
} from "./api.js";
import { reportMetadataRefresh } from "./refresh-feedback.js";

export const relationsQuery = (id: string, page: number) =>
	queryOptions({
		queryKey: ["metadata-relations", id, page],
		queryFn: ({ signal }) =>
			getRelations(id, page, { signal: boundedSignal(signal) }),
	});

export const metadataSearchQuery = (query: string, page: number) =>
	queryOptions({
		queryKey: ["metadata-search", query, page],
		queryFn: ({ signal }) =>
			searchMetadata(query, page, { signal: boundedSignal(signal) }),
	});
export const metadataDetailQuery = (reference: { id: string }) =>
	queryOptions({
		queryKey: ["metadata-detail", reference],
		queryFn: async ({ signal, client }) => {
			const result = await metadataDetail(reference, {
				signal: boundedSignal(signal),
			});
			signal.throwIfAborted();
			reportMetadataRefresh(client, result);
			return result;
		},
	});

export const identificationQuery = (scope: string) =>
	queryOptions({
		queryKey: ["identification", scope],
		queryFn: ({ signal }) =>
			getIdentificationStatus({ signal: boundedSignal(signal) }),
		staleTime: 0,
		refetchOnWindowFocus: true,
		refetchInterval: (query) => (query.state.data?.running ? 1500 : 60_000),
	});

export const airingQuery = (id: string) =>
	infiniteQueryOptions({
		queryKey: ["metadata-airing", id],
		initialPageParam: 1,
		queryFn: ({ signal, pageParam }) =>
			getAiring(id, pageParam, { signal: boundedSignal(signal) }),
		getNextPageParam: (last) =>
			last.data.hasNextPage ? last.data.page + 1 : undefined,
		staleTime: 60_000,
		refetchOnWindowFocus: true,
		refetchInterval: (query) =>
			query.state.data?.pages.some((page) => page.refreshing)
				? 2000
				: 15 * 60_000,
	});
