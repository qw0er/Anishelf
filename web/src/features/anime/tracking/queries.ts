import { queryOptions } from "@tanstack/react-query";
import { request } from "../../../shared/api/client.js";
import type {
	TrackingAccountResponse,
	TrackingEntryResponse,
	TrackingListResponse,
} from "../../../shared/api/contracts.js";
import { boundedSignal } from "../../../shared/api/queries.js";
import {
	clearTrackingReadFailure,
	reportTrackingReadFailure,
	reportTrackingRefresh,
} from "./refresh-feedback.js";
export const accountQuery = () =>
	queryOptions({
		queryKey: ["tracking", "account"] as const,
		queryFn: async ({ signal, client }) => {
			try {
				const result = await request<TrackingAccountResponse>(
					"/api/tracking/account",
					"GET",
					{ signal: boundedSignal(signal) },
				);
				signal.throwIfAborted();
				clearTrackingReadFailure(client, result.generation);
				return result;
			} catch (error) {
				const cached = client.getQueryData<TrackingAccountResponse>([
					"tracking",
					"account",
				]);
				if (cached)
					reportTrackingReadFailure(
						client,
						cached.generation,
						error,
						cached.checkedAt,
					);
				throw error;
			}
		},
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
		queryFn: async ({ signal, client, queryKey }) => {
			try {
				const result = await request<TrackingEntryResponse>(
					`/api/tracking/entries/${encodeURIComponent(mediaId)}?${new URLSearchParams({ generation: identity.generation })}`,
					"GET",
					{ signal: boundedSignal(signal) },
				);
				signal.throwIfAborted();
				reportTrackingRefresh(client, result);
				return result;
			} catch (error) {
				const cached = client.getQueryData<TrackingEntryResponse>(queryKey);
				if (cached?.fetchedAt != null)
					reportTrackingReadFailure(
						client,
						identity.generation,
						error,
						cached.fetchedAt,
					);
				throw error;
			}
		},
		refetchOnWindowFocus: true,
		refetchInterval: (query) =>
			query.state.data?.refreshing ? 1500 : 5 * 60_000,
	});
export function refreshTrackingList(generation: string) {
	return request<TrackingListResponse>(
		"/api/tracking/refresh",
		"POST",
		{},
		{ generation },
	);
}
