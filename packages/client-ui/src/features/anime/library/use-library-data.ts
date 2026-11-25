import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "../../../shared/api/queries.js";
import { readRetryOptions } from "../../../shared/api/read-retry.js";
import {
	accountQuery,
	trackingIdentity,
	useTrackingRefresh,
} from "../tracking/public.js";
import type { LibraryFilters } from "./api.js";
import { animeLibraryQuery } from "./queries.js";

const readRetry = readRetryOptions("anime-library");

/** Only account-scoped reads include viewing filters and private list entries. */
export function useLibraryData(filters: LibraryFilters, enabled: boolean) {
	const client = useQueryClient();
	const account = useQuery(accountQuery());
	const identity = account.data?.account
		? trackingIdentity(account.data)
		: undefined;
	const appliedFilters = identity
		? filters
		: { ...filters, viewingStatus: "all" as const };
	const options = animeLibraryQuery(appliedFilters, useQueryScope(), identity);
	const query = useQuery({
		...options,
		...readRetry,
		retry: (failureCount, error) =>
			!client.getQueryData(options.queryKey) &&
			readRetry.retry(failureCount, error),
		enabled,
	});
	const refresh = useTrackingRefresh(account.data);
	return {
		account: account.data,
		accountError: account.isError && !account.data,
		retryAccount: account.refetch,
		data: query.data,
		error: query.error,
		failureReason: query.failureReason,
		errorUpdateCount: query.errorUpdateCount,
		fetchStatus: query.fetchStatus,
		isPending: query.isPending,
		isFetching: query.isFetching,
		refetch: query.refetch,
		refresh,
	};
}
