import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TrackingEntryResponse } from "../../../shared/api/contracts.js";
import { invalidateAnimeQueries } from "../shared/query-keys.js";
import { refreshTrackingList } from "./queries.js";
import type { ViewingState } from "./use-viewing-state.js";
export function useDetailViewing(
	snapshot: TrackingEntryResponse,
	mediaId: string,
	retry: () => void,
): ViewingState {
	const client = useQueryClient();
	const refresh = useMutation({
		mutationFn: () => refreshTrackingList(snapshot.generation),
		onSettled: () => invalidateAnimeQueries(client, "viewing"),
	});
	return {
		mediaId,
		visible: snapshot.accountId !== null,
		unmapped: !mediaId.startsWith(
			`${encodeURIComponent(snapshot.provider.key)}:anime:`,
		),
		loading: false,
		refreshing: refresh.isPending || snapshot.refreshing,
		reconnect: snapshot.state === "authorization-required",
		snapshot,
		error: refresh.error,
		retry,
		refresh: () => refresh.mutate(),
	};
}
