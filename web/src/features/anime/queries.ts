import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../shared/api/queries.js";
import {
	type CatalogFilters,
	getCatalog,
	getRelations,
	getWork,
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
