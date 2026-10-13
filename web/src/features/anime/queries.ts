import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../shared/api/queries.js";
import {
	type CatalogFilters,
	getCatalog,
	getIdentificationStatus,
	getRelations,
	getReview,
	getReviews,
	getSource,
	getWork,
	metadataDetail,
	searchMetadata,
} from "./api.js";

export const catalogQuery = (filters: CatalogFilters, scope: string) =>
	queryOptions({
		queryKey: ["catalog", scope, "list", filters],
		queryFn: ({ signal }) =>
			getCatalog(filters, { signal: boundedSignal(signal) }),
	});
export const workQuery = (id: string, scope: string) =>
	queryOptions({
		queryKey: ["catalog", scope, "detail", id],
		queryFn: ({ signal }) => getWork(id, { signal: boundedSignal(signal) }),
	});
export const relationsQuery = (provider: string, id: string, page: number) =>
	queryOptions({
		queryKey: ["metadata-relations", provider, id, page],
		queryFn: ({ signal }) =>
			getRelations(provider, id, page, { signal: boundedSignal(signal) }),
	});

export const reviewsQuery = (decision: string, page: number, scope: string) =>
	queryOptions({
		queryKey: ["catalog", scope, "reviews", decision, page],
		queryFn: ({ signal }) =>
			getReviews(decision, page, { signal: boundedSignal(signal) }),
	});
export const reviewQuery = (id: string, scope: string) =>
	queryOptions({
		queryKey: ["catalog", scope, "review", id],
		queryFn: ({ signal }) => getReview(id, { signal: boundedSignal(signal) }),
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

export const sourceQuery = (id: string, scope: string) =>
	queryOptions({
		queryKey: ["catalog", scope, "source", id],
		queryFn: ({ signal }) => getSource(id, { signal: boundedSignal(signal) }),
	});
