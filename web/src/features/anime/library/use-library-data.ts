import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "../../../shared/api/queries.js";
import { animeLibraryQueryKey } from "../shared/query-keys.js";
import {
	accountQuery,
	refreshTrackingList,
	trackingIdentity,
} from "../tracking/public.js";
import type { LibraryFilters } from "./api.js";
import { animeLibraryQuery } from "./queries.js";

/** One owner for the wall's account dependency, list reads and explicit refresh. */
export function useLibraryData(filters: LibraryFilters, enabled: boolean) {
	const client = useQueryClient();
	const account = useQuery(accountQuery());
	const query = useQuery({
		...animeLibraryQuery(
			filters,
			useQueryScope(),
			account.isSuccess ? trackingIdentity(account.data) : undefined,
		),
		enabled,
	});
	const refresh = useMutation({
		mutationFn: () => {
			if (!account.data)
				throw new Error("Tracking account status is unavailable.");
			return refreshTrackingList(account.data.generation);
		},
		onSettled: async () => {
			await Promise.all([
				client.invalidateQueries({ queryKey: ["tracking"] }),
				client.invalidateQueries({ queryKey: animeLibraryQueryKey }),
			]);
		},
	});
	return {
		account: account.data,
		data: account.isSuccess ? query.data : undefined,
		error: account.error ?? query.error,
		isPending: account.isPending || query.isPending,
		isFetching: account.isFetching || query.isFetching,
		refetch: () => (account.isError ? account.refetch() : query.refetch()),
		refresh,
	};
}
