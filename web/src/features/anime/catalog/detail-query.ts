import { queryOptions } from "@tanstack/react-query";
import { request } from "../../../shared/api/client.js";
import type { AnimeDetailResponse } from "../../../shared/api/contracts.js";
import { boundedSignal } from "../../../shared/api/queries.js";
export const animeDetailQuery = (key: string, scope: string) =>
	queryOptions({
		queryKey: ["anime-detail", scope, "work", key],
		queryFn: ({ signal }) =>
			request<AnimeDetailResponse>(
				`/api/anime/details/works/${encodeURIComponent(key)}`,
				"GET",
				{ signal: boundedSignal(signal) },
			),
		staleTime: 0,
		refetchOnWindowFocus: true,
		refetchInterval: (query) =>
			query.state.data?.downloads?.active
				? 5_000
				: query.state.data?.metadata?.refreshing ||
						query.state.data?.viewing.refreshing
					? 2000
					: 30_000,
	});
