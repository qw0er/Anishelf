import { workReference } from "@anishelf/backend/contracts/references";
import { useQuery } from "@tanstack/react-query";
import type { TrackingEntryResponse } from "../../../shared/api/contracts.js";
import { accountQuery, entryQuery, trackingIdentity } from "./queries.js";
import { useTrackingRefresh } from "./use-list-refresh.js";

export interface ViewingState {
	mediaId?: string | undefined;
	visible: boolean;
	unmapped?: boolean;
	loading: boolean;
	refreshing: boolean;
	reconnect: boolean;
	snapshot: TrackingEntryResponse | undefined;
	error: Error | null;
	retry(): void;
	refresh?(): void;
}

/** Both detail routes share account-scoped reads and distinguish unknown from absent entries. */
export function useViewingState(mediaId: string | undefined): ViewingState {
	const account = useQuery({ ...accountQuery(), enabled: Boolean(mediaId) });
	let provider: string | undefined;
	try {
		if (mediaId) provider = workReference(mediaId).provider;
	} catch {
		/* Invalid route identities cannot request a list entry. */
	}
	const unmapped = Boolean(
		mediaId && account.data && provider !== account.data.provider.key,
	);
	const entry = useQuery({
		...entryQuery(
			mediaId ?? "",
			account.data
				? trackingIdentity(account.data)
				: { accountId: null, generation: "" },
		),
		enabled: Boolean(mediaId && provider && !unmapped && account.data?.account),
	});
	const refresh = useTrackingRefresh(account.data);
	return {
		unmapped,
		mediaId,
		visible: Boolean(mediaId && (account.isPending || account.data?.account)),
		loading: account.isPending || entry.isPending,
		refreshing:
			refresh.isPending || entry.isFetching || Boolean(entry.data?.refreshing),
		refresh: () => refresh.mutate(),
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
