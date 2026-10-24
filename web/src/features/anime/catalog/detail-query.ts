import { queryOptions } from "@tanstack/react-query";
import { request } from "../../../shared/api/client.js";
import type { AnimeDetailResponse } from "../../../shared/api/contracts.js";
import { boundedSignal } from "../../../shared/api/queries.js";
export const animeDetailQuery = (key: string, scope: string) =>
	queryOptions({
		queryKey: ["anime-detail", scope, "work", key],
		queryFn: async ({ signal, client }) => {
			const startedAt = Date.now();
			const detail = await request<AnimeDetailResponse>(
				`/api/anime/details/works/${encodeURIComponent(key)}`,
				"GET",
				{ signal: boundedSignal(signal) },
			);
			signal.throwIfAborted();
			if (detail.local) {
				const aliasKey = ["anime-detail", scope, "local", detail.local.work.id];
				if ((client.getQueryState(aliasKey)?.dataUpdatedAt ?? 0) <= startedAt)
					client.setQueryData(
						aliasKey,
						{ ...detail.local, detail },
						{ updatedAt: startedAt },
					);
			}
			return detail;
		},
		staleTime: 60_000,
		gcTime: 15 * 60_000,
		refetchOnWindowFocus: true,
		refetchInterval: (query) =>
			query.state.data?.metadata?.refreshing ? 2000 : false,
	});
