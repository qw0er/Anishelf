import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isRequestCancelled } from "../../../shared/api/client.js";
import type { TrackingAccountResponse } from "../../../shared/api/contracts.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { getErrorTranslationKey } from "../../../shared/lib/error-translation.js";
import { invalidateAnimeQueries } from "../shared/query-keys.js";
import { refreshTrackingList } from "./queries.js";
import {
	reportTrackingRefresh,
	trackingRefreshNoticeId,
} from "./refresh-feedback.js";
export function useTrackingRefresh(data: TrackingAccountResponse | undefined) {
	const account = { data };
	const client = useQueryClient();
	const { t } = useTranslation();
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
				invalidateAnimeQueries(client, "viewing"),
			]);
		},
	});
	return refresh;
}
