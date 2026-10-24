import type { UseQueryResult } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { request } from "../../../shared/api/client.js";
import type { AnimeStatusResponse } from "../../../shared/api/contracts.js";
import { boundedSignal } from "../../../shared/api/queries.js";

export type AnimeStatusState = Pick<
	UseQueryResult<AnimeStatusResponse>,
	"data" | "isPending" | "isError" | "isFetching" | "dataUpdatedAt" | "refetch"
>;
const animeStatusKey = ["anime-status"] as const;
export const animeStatusQuery = (key: string, scope: string) =>
	queryOptions({
		queryKey: [...animeStatusKey, scope, key],
		enabled: Boolean(key),
		queryFn: ({ signal }) =>
			request<AnimeStatusResponse>(
				`/api/anime/status/${encodeURIComponent(key)}`,
				"GET",
				{ signal: boundedSignal(signal) },
			),
		staleTime: 5_000,
		gcTime: 15 * 60_000,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
		refetchInterval: (query) => {
			const status = query.state.data;
			if (status?.viewing.refreshing) return 2_000;
			if (
				status?.downloads?.active ||
				(status?.subscription.subscription?.sourceKind === "automatic" &&
					status.subscription.subscription.enabled &&
					!status.subscription.subscription.error)
			)
				return 5_000;
			return 60_000;
		},
	});
