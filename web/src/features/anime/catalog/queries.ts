import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../../shared/api/queries.js";
import { reportMetadataRefresh } from "../metadata/public.js";
import {
	getFileReviews,
	getLocalWorkDetail,
	getSource,
	getWorkReviews,
} from "./api.js";

export const localWorkDetailQuery = (id: string, scope: string) =>
	queryOptions({
		queryKey: ["anime-detail", scope, "local", id],
		queryFn: async ({ signal, client }) => {
			const result = await getLocalWorkDetail(id, {
				signal: boundedSignal(signal),
			});
			signal.throwIfAborted();
			reportMetadataRefresh(client, result.metadata);
			return result;
		},
		// Reuse the route loader result when the detail component mounts.
		staleTime: 1000,
		refetchOnWindowFocus: true,
		refetchInterval: (query) => {
			if (query.state.data?.detail.downloads?.active) return 5_000;
			if (
				query.state.data?.metadata.refreshing ||
				query.state.data?.detail.viewing.refreshing
			)
				return 2000;
			// Idle detail pages need no polling; focus refetch resynchronizes instead.
			return false;
		},
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
