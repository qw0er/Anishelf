import { hashKey, queryOptions, skipToken } from "@tanstack/react-query";
import type { AnimeLibraryResponse } from "../../../shared/api/contracts.js";
import { boundedSignal } from "../../../shared/api/queries.js";
import { animeLibraryQueryKey } from "../shared/query-keys.js";
import {
	reportTrackingReadFailure,
	reportTrackingRefresh,
	type TrackingIdentity,
} from "../tracking/public.js";
import { getAnimeLibrary, type LibraryFilters } from "./api.js";

export const animeLibraryQuery = (
	filters: LibraryFilters,
	scope: string,
	identity: TrackingIdentity | undefined,
) =>
	queryOptions({
		queryKey: [
			...animeLibraryQueryKey,
			scope,
			identity?.accountId ?? null,
			identity?.generation ?? null,
			filters,
		],
		queryFn: identity
			? async ({ signal, client, queryKey }) => {
					try {
						const result = await getAnimeLibrary(filters, identity.generation, {
							signal: boundedSignal(signal),
						});
						signal.throwIfAborted();
						reportTrackingRefresh(client, result.tracking);
						return result;
					} catch (error) {
						const cached = client.getQueryData<AnimeLibraryResponse>(queryKey);
						if (cached)
							reportTrackingReadFailure(
								client,
								identity.generation,
								error,
								cached.tracking.fetchedAt,
							);
						throw error;
					}
				}
			: skipToken,
		placeholderData: (previous, query) => {
			if (
				!query ||
				query.queryKey[1] !== scope ||
				query.queryKey[2] !== (identity?.accountId ?? null) ||
				query.queryKey[3] !== (identity?.generation ?? null)
			)
				return undefined;
			const { page: _previousPage, ...previousFilters } = query
				.queryKey[4] as LibraryFilters;
			const { page: _page, ...currentFilters } = filters;
			return hashKey([previousFilters]) === hashKey([currentFilters])
				? previous
				: undefined;
		},
		gcTime: 15 * 60_000,
		refetchOnWindowFocus: true,
		refetchInterval: (query) =>
			query.state.data?.tracking.refreshing ? 1500 : 5 * 60_000,
	});
