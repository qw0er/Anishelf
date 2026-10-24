import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TrackingEntryResponse } from "../../../shared/api/contracts.js";
import { invalidateAnimeQueries } from "../shared/query-keys.js";
import { refreshTrackingList } from "./queries.js";
import type { ViewingState } from "./use-viewing-state.js";
export function useDetailViewing(
	snapshot: TrackingEntryResponse | undefined,
	mediaId: string,
	retry: () => void,
	error: Error | null = null,
): ViewingState {
	const client = useQueryClient();
	const refresh = useMutation({
		mutationFn: () =>
			snapshot
				? refreshTrackingList(snapshot.generation)
				: Promise.reject(new Error("Viewing state is unavailable.")),
		onSettled: () => invalidateAnimeQueries(client, "viewing"),
	});
	return {
		mediaId,
		visible: snapshot === undefined || snapshot.accountId !== null,
		unmapped:
			snapshot !== undefined &&
			!mediaId.startsWith(
				`${encodeURIComponent(snapshot.provider.key)}:anime:`,
			),
		loading: snapshot === undefined && !error,
		refreshing: refresh.isPending || Boolean(snapshot?.refreshing),
		reconnect: snapshot?.state === "authorization-required",
		snapshot,
		error: error ?? refresh.error,
		retry,
		refresh: () => refresh.mutate(),
	};
}
