import { useQuery } from "@tanstack/react-query";
import { useQueryScope } from "../../../shared/api/queries.js";
import {
	accountQuery,
	trackingIdentity,
	useTrackingRefresh,
} from "../tracking/public.js";
import type { LibraryFilters } from "./api.js";
import { animeLibraryQuery } from "./queries.js";

/** Only account-scoped reads include viewing filters and private list entries. */
export function useLibraryData(filters: LibraryFilters, enabled: boolean) {
	const account = useQuery(accountQuery());
	const identity = account.data?.account
		? trackingIdentity(account.data)
		: undefined;
	const appliedFilters = identity
		? filters
		: { ...filters, viewingStatus: "all" as const };
	const query = useQuery({
		...animeLibraryQuery(appliedFilters, useQueryScope(), identity),
		enabled,
	});
	const refresh = useTrackingRefresh(account.data);
	return {
		account: account.data,
		accountError: account.isError && !account.data,
		retryAccount: account.refetch,
		data: query.data,
		error: query.error,
		isPending: query.isPending,
		isFetching: query.isFetching,
		refetch: query.refetch,
		refresh,
	};
}
