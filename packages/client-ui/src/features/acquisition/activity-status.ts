import type { TFunction } from "i18next";
import type { DownloadActivity } from "../../shared/api/contracts.js";
export function activityStatus(
	item: DownloadActivity["items"][number],
	t: TFunction,
): string {
	if (item.error && item.state !== "missing")
		return item.ingestion === "failed"
			? t("acquisition.activity.importFailed")
			: item.ingestion === "review"
				? t("acquisition.activity.reviewRequired")
				: t("acquisition.activity.needsAttention");
	if (item.state === "available") return t("acquisition.activity.available");
	if (item.state === "missing")
		return t("acquisition.activity.removedInQbittorrent");
	if (item.ingestion === "validating")
		return t("acquisition.activity.importing");
	if (item.state === "unknown" || item.state === "submitting")
		return t("acquisition.activity.confirmingSubmission");
	if (item.state === "discovering") return t("acquisition.episode.searching");
	if (item.state === "pending")
		return t("acquisition.activity.waitingToSubmit");
	if (/paused|stopped/i.test(item.transfer ?? ""))
		return t("acquisition.activity.paused");
	if (/error|missing/i.test(item.transfer ?? ""))
		return t("acquisition.activity.downloadError");
	if (/checking/i.test(item.transfer ?? ""))
		return t("acquisition.activity.checking");
	if (/meta/i.test(item.transfer ?? ""))
		return t("acquisition.activity.fetchingMetadata");
	if (/queued/i.test(item.transfer ?? ""))
		return t("acquisition.activity.queued");
	if (item.progress === 1) return t("acquisition.activity.downloaded");
	return item.progress === null
		? t("acquisition.activity.downloading")
		: t("acquisition.activity.downloadingPercent", {
				percent: Math.round(item.progress * 100),
			});
}

export function episodeNeedsAttention(
	item: DownloadActivity["items"][number],
): boolean {
	return (
		!!item.error ||
		["blocked", "missing", "unknown"].includes(item.state) ||
		["failed", "review"].includes(item.ingestion) ||
		/error|missing/i.test(item.transfer ?? "")
	);
}

/** Compact row labels; full task details retain transfer and ingestion stages. */
export function episodeActivityStatus(
	item: DownloadActivity["items"][number],
	t: TFunction,
): string {
	if (episodeNeedsAttention(item))
		return t("acquisition.episode.compactAttention");
	if (item.state === "available") return t("acquisition.episode.viewTask");
	if (item.state === "discovering")
		return t("acquisition.episode.compactSearching");
	if (item.ingestion === "validating" || item.progress === 1)
		return t("acquisition.episode.compactProcessing");
	if (/paused|stopped/i.test(item.transfer ?? ""))
		return t("acquisition.episode.compactPaused");
	if (/checking|meta/i.test(item.transfer ?? ""))
		return t("acquisition.episode.compactProcessing");
	if (
		["pending", "submitting"].includes(item.state) ||
		/queued/i.test(item.transfer ?? "")
	)
		return t("acquisition.episode.compactWaiting");
	return item.progress === null
		? t("acquisition.activity.downloading")
		: `↓ ${Math.round(item.progress * 100)}%`;
}
