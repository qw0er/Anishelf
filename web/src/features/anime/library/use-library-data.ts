import { useQuery } from "@tanstack/react-query";
import { useQueryScope } from "../../../shared/api/queries.js";
import {
	accountQuery,
	trackingIdentity,
	useTrackingRefresh,
} from "../tracking/public.js";
import type { LibraryFilters } from "./api.js";
import { animeLibraryQuery } from "./queries.js";

/** One owner for the wall's account dependency, list reads and explicit refresh. */
export function useLibraryData(filters: LibraryFilters, enabled: boolean) {
	const account = useQuery(accountQuery());
	const query = useQuery({
		...animeLibraryQuery(
			filters,
			useQueryScope(),
			account.data ? trackingIdentity(account.data) : undefined,
		),
		enabled,
	});
	const refresh = useTrackingRefresh(account.data);
	return {
		account: account.data,
		data: account.data ? query.data : undefined,
		error: account.error ?? query.error,
		isPending: account.isPending || query.isPending,
		isFetching: account.isFetching || query.isFetching,
		refetch: () => (account.isError ? account.refetch() : query.refetch()),
		refresh,
	};
}
