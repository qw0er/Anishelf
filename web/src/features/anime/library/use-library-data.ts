import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isRequestCancelled } from "../../../shared/api/client.js";
import { useQueryScope } from "../../../shared/api/queries.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { getErrorTranslationKey } from "../../../shared/lib/error-translation.js";
import { animeLibraryQueryKey } from "../shared/query-keys.js";
import {
	accountQuery,
	refreshTrackingList,
	reportTrackingRefresh,
	trackingIdentity,
	trackingRefreshNoticeId,
} from "../tracking/public.js";
import type { LibraryFilters } from "./api.js";
import { animeLibraryQuery } from "./queries.js";

/** One owner for the wall's account dependency, list reads and explicit refresh. */
export function useLibraryData(filters: LibraryFilters, enabled: boolean) {
	const client = useQueryClient();
	const { t } = useTranslation();
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
		onMutate: () => {
			if (account.data)
				toast.close(trackingRefreshNoticeId(account.data.generation));
		},
		onSuccess: (result) => reportTrackingRefresh(client, result, true),
		onError: (error) => {
			if (!isRequestCancelled(error))
				toast.add({
					id: trackingRefreshNoticeId(account.data?.generation ?? "unknown"),
					type: "error",
					priority: "high",
					title: t(
						getErrorTranslationKey(error) ?? "trackingList.refreshFailed",
					),
				});
		},
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
