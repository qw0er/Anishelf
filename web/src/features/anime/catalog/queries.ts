import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../../shared/api/queries.js";
import {
	type CatalogFilters,
	getCatalog,
	getFileReviews,
	getSource,
	getWork,
	getWorkReviews,
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
export const sourceQuery = (id: string, scope: string) =>
	queryOptions({
		queryKey: ["catalog", scope, "source", id],
		queryFn: ({ signal }) => getSource(id, { signal: boundedSignal(signal) }),
	});

export const fileReviewsQuery = (ids: string[], scope: string) =>
	queryOptions({
		queryKey: ["catalog", scope, "files", ids],
		queryFn: async ({ signal }) => {
			const items = [];
			for (let start = 0; start < ids.length; start += 100)
				items.push(
					...(await getFileReviews(ids.slice(start, start + 100), {
						signal: boundedSignal(signal),
					})),
				);
			return items;
		},
	});
export const workReviewsQuery = (id: string, page: number, scope: string) =>
	queryOptions({
		queryKey: ["catalog", scope, "work-reviews", id, page],
		queryFn: ({ signal }) =>
			getWorkReviews(id, page, { signal: boundedSignal(signal) }),
	});
