import { queryOptions } from "@tanstack/react-query";
import { request } from "../../../shared/api/client.js";
import type {
	TrackingAccountResponse,
	TrackingEntryResponse,
	TrackingListResponse,
} from "../../../shared/api/contracts.js";
import { boundedSignal } from "../../../shared/api/queries.js";
export const accountQuery = () =>
	queryOptions({
		queryKey: ["tracking", "account"] as const,
		queryFn: ({ signal }) =>
			request<TrackingAccountResponse>("/api/tracking/account", "GET", {
				signal: boundedSignal(signal),
			}),
		retry: false,
		staleTime: 0,
	});
export interface TrackingIdentity {
	accountId: number | null;
	generation: string;
}
export const trackingIdentity = (
	account: TrackingAccountResponse,
): TrackingIdentity => ({
	accountId: account.account?.id ?? null,
	generation: account.generation,
});
export const entryQuery = (mediaId: string, identity: TrackingIdentity) =>
	queryOptions({
		queryKey: [
			"tracking",
			"entry",
			identity.accountId,
			identity.generation,
			mediaId,
		],
		queryFn: ({ signal }) =>
			request<TrackingEntryResponse>(
				`/api/tracking/entries/${encodeURIComponent(mediaId)}?${new URLSearchParams({ generation: identity.generation })}`,
				"GET",
				{ signal: boundedSignal(signal) },
			),
		refetchInterval: (query) => (query.state.data?.refreshing ? 1500 : 60_000),
	});
export function refreshTrackingList(generation: string) {
	return request<TrackingListResponse>(
		"/api/tracking/refresh",
		"POST",
		{},
		{ generation },
	);
}
