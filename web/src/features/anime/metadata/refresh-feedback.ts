import type { QueryClient } from "@tanstack/react-query";
import type { MetadataDetailsResponse } from "../../../shared/api/contracts.js";
import { toast } from "../../../shared/components/ui/toast.js";
import i18n from "../../../shared/i18n.js";
import { reportRefreshFailure } from "../shared/refresh-feedback.js";

export const metadataRefreshNoticeId = (provider: string, id: string) =>
	`metadata-refresh:${provider}:${id}`;

export function reportMetadataRefresh(
	client: QueryClient,
	metadata: MetadataDetailsResponse,
	manual = false,
): void {
	if (metadata.refreshing) return;
	const { reference } = metadata.data;
	const id = metadataRefreshNoticeId(reference.provider, reference.id);
	reportRefreshFailure(client, {
		id,
		failure: metadata.refreshError,
		fetchedAt: metadata.fetchedAt,
		title: i18n.t("anime.refreshFailed"),
		manual,
	});
	if (manual && !metadata.refreshError)
		toast.add({ id, type: "success", title: i18n.t("anime.refreshed") });
}
