import type { QueryClient } from "@tanstack/react-query";
import {
	ApiClientError,
	isRequestCancelled,
} from "../../../shared/api/client.js";
import type { TrackingListResponse } from "../../../shared/api/contracts.js";
import { toast } from "../../../shared/components/ui/toast.js";
import i18n from "../../../shared/i18n.js";
import { reportRefreshFailure } from "../shared/refresh-feedback.js";

export const trackingRefreshNoticeId = (generation: string) =>
	`tracking-refresh:${generation}`;

export function reportTrackingRefresh(
	client: QueryClient,
	snapshot: Omit<TrackingListResponse, "entries">,
	manual = false,
): void {
	clearTrackingReadFailure(client, snapshot.generation);
	if (snapshot.refreshing) return;
	const id = trackingRefreshNoticeId(snapshot.generation);
	const failure =
		snapshot.state === "authorization-required" ? null : snapshot.error;
	// An initial unavailable snapshot needs persistent context, rather than an automatic Toast.
	if (snapshot.fetchedAt !== null || manual || !failure)
		reportRefreshFailure(client, {
			id,
			failure,
			fetchedAt: snapshot.fetchedAt,
			title: i18n.t(
				snapshot.fetchedAt === null
					? "trackingList.refreshFailed"
					: "trackingList.failed",
			),
			manual,
		});
	if (
		manual &&
		snapshot.state === "connected" &&
		!snapshot.error &&
		snapshot.fetchedAt !== null
	)
		toast.add({ id, type: "success", title: i18n.t("trackingList.refreshed") });
}

/** Cached content remains usable after a transport failure; report outside page layout. */
export function reportTrackingReadFailure(
	client: QueryClient,
	generation: string,
	error: unknown,
	fetchedAt: number | null,
): void {
	if (isRequestCancelled(error)) return;
	reportRefreshFailure(client, {
		id: `${trackingRefreshNoticeId(generation)}:read`,
		failure: {
			code:
				error instanceof ApiClientError
					? (error.code ?? error.kind)
					: "unavailable",
			retryAt: null,
		},
		fetchedAt,
		title: i18n.t("trackingList.failed"),
	});
}

export function clearTrackingReadFailure(
	client: QueryClient,
	generation: string,
): void {
	reportRefreshFailure(client, {
		id: `${trackingRefreshNoticeId(generation)}:read`,
		failure: null,
		fetchedAt: null,
		title: "",
	});
}
