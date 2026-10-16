import { queryOptions, skipToken } from "@tanstack/react-query";
import { boundedSignal } from "../../../shared/api/queries.js";
import { animeLibraryQueryKey } from "../shared/query-keys.js";
import type { TrackingIdentity } from "../tracking/public.js";
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
			? ({ signal }) =>
					getAnimeLibrary(filters, identity.generation, {
						signal: boundedSignal(signal),
					})
			: skipToken,
		refetchInterval: (query) =>
			query.state.data?.tracking.refreshing ? 1500 : 60_000,
	});
