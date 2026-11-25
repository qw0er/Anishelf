import { queryOptions } from "@tanstack/react-query";
import { request } from "../../../shared/api/client.js";
import type { AnimeDetailResponse } from "../../../shared/api/contracts.js";
import {
	boundedSignal,
	queryScopeIdentity,
} from "../../../shared/api/queries.js";
import { readRetryOptions } from "../../../shared/api/read-retry.js";
export const animeDetailQuery = (
	key: string,
	scope: string,
	identity: "work" | "metadata" = "work",
) =>
	queryOptions({
		...readRetryOptions("work-detail"),
		queryKey: ["anime-detail", scope, identity, key],
		queryFn: async ({ signal, client }) => {
			const startedAt = Date.now();
			const detail = await request<AnimeDetailResponse>(
				`/api/anime/details/${identity === "metadata" ? "metadata" : "works"}/${encodeURIComponent(key)}`,
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
		placeholderData: (previous, query) =>
			query &&
			queryScopeIdentity(String(query.queryKey[1])) ===
				queryScopeIdentity(scope) &&
			query.queryKey[2] === identity &&
			query.queryKey[3] === key
				? previous
				: undefined,
		staleTime: 60_000,
		gcTime: 15 * 60_000,
		refetchOnWindowFocus: true,
		refetchInterval: (query) =>
			query.state.data?.metadata?.refreshing ? 2000 : false,
	});
