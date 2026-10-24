import { workKey } from "@anishelf/backend/contracts/references";
import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../../shared/api/queries.js";
import { reportMetadataRefresh } from "../metadata/public.js";
import {
	getFileReviews,
	getLocalWorkDetail,
	getSource,
	getWorkReviews,
} from "./api.js";
import { animeDetailQuery } from "./detail-query.js";

export const localWorkDetailQuery = (id: string, scope: string) =>
	queryOptions({
		queryKey: ["anime-detail", scope, "local", id],
		queryFn: async ({ signal, client }) => {
			const startedAt = Date.now();
			const result = await getLocalWorkDetail(id, {
				signal: boundedSignal(signal),
			});
			signal.throwIfAborted();
			reportMetadataRefresh(client, result.metadata);
			const canonicalKey = animeDetailQuery(
				workKey(result.detail.reference),
				scope,
			).queryKey;
			if ((client.getQueryState(canonicalKey)?.dataUpdatedAt ?? 0) <= startedAt)
				client.setQueryData(canonicalKey, result.detail, {
					updatedAt: startedAt,
				});
			return result;
		},
		// Reuse the route loader result when the detail component mounts.
		staleTime: 60_000,
		gcTime: 15 * 60_000,
		refetchOnWindowFocus: true,
		refetchInterval: (query) =>
			query.state.data?.metadata.refreshing ? 2000 : false,
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
