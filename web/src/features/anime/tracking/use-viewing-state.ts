import { useQuery } from "@tanstack/react-query";
import type { TrackingEntryResponse } from "../../../shared/api/contracts.js";
import { accountQuery, entryQuery, trackingIdentity } from "./queries.js";

export interface ViewingState {
	visible: boolean;
	loading: boolean;
	refreshing: boolean;
	reconnect: boolean;
	snapshot: TrackingEntryResponse | undefined;
	error: Error | null;
	retry(): void;
}

/** Both detail routes share account-scoped reads and distinguish unknown from absent entries. */
export function useViewingState(mediaId: string | undefined): ViewingState {
	const account = useQuery({ ...accountQuery(), enabled: Boolean(mediaId) });
	const entry = useQuery({
		...entryQuery(
			mediaId ?? "",
			account.data
				? trackingIdentity(account.data)
				: { accountId: null, generation: "" },
		),
		enabled: Boolean(mediaId && account.data?.account),
	});
	return {
		visible: Boolean(mediaId && (account.isPending || account.data?.account)),
		loading: account.isPending || entry.isPending,
		refreshing: Boolean(entry.data?.refreshing),
		reconnect:
			account.data?.state === "authorization-required" ||
			entry.data?.state === "authorization-required",
		snapshot: entry.data,
		error: account.error ?? entry.error,
		retry: () => {
			if (account.isError) void account.refetch();
			else void entry.refetch();
		},
	};
}
