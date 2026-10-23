import type { TFunction } from "i18next";

interface ViewingProgress {
	progress: number;
	aired?: number | null | undefined;
	total?: number | null | undefined;
}

function airedCount(value: ViewingProgress): number | null {
	return typeof value.aired === "number" && value.aired > 0
		? value.aired
		: null;
}

function totalCount(value: ViewingProgress): number | null {
	return typeof value.total === "number" && value.total > 0
		? value.total
		: null;
}

/** Compact `progress / aired (total)` label used in library cards. */
export function compactViewingProgress(
	value: ViewingProgress,
	t: TFunction,
): string {
	const aired = airedCount(value);
	const total = totalCount(value);
	if (aired !== null && total !== null && aired < total)
		return t("trackingList.progressWithAired", {
			progress: value.progress,
			aired,
			total,
		});
	if (total !== null)
		return t("trackingList.progressTotal", {
			progress: value.progress,
			total,
		});
	if (aired !== null)
		return t("trackingList.progressAired", {
			progress: value.progress,
			aired,
		});
	return t("trackingList.watchedCount", { count: value.progress });
}

/** Sentence label used in the anime detail viewing summary. */
export function sentenceViewingProgress(
	value: ViewingProgress,
	t: TFunction,
): string {
	const aired = airedCount(value);
	const total = totalCount(value);
	if (aired !== null && total !== null && aired < total)
		return t("trackingList.episodeProgressWithAired", {
			progress: value.progress,
			aired,
			total,
		});
	if (total !== null)
		return t("trackingList.episodeProgress", {
			progress: value.progress,
			total,
		});
	if (aired !== null)
		return t("trackingList.episodeProgressAired", {
			progress: value.progress,
			aired,
		});
	return t("trackingList.episodes", { count: value.progress });
}
