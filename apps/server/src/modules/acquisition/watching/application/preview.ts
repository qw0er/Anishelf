import type { WatchingMember } from "../domain/model.js";
import type {
	WatchingConfig,
	WatchingPreview,
	WatchingSnapshot,
} from "../public.js";

export function watchingStartEpisode(
	progress: number,
	backlog: WatchingConfig["backlog"],
): number | null {
	if (backlog === "beginning") return 1;
	return Number.isSafeInteger(progress) && progress >= 0 && progress < 10000
		? progress + 1
		: null;
}

export function projectWatchingPreviewWork({
	entry,
	backlog,
	member,
	existingReason,
	hasSearchSource,
}: {
	entry: WatchingSnapshot["entries"][number];
	backlog: WatchingConfig["backlog"];
	member: WatchingMember | null | undefined;
	existingReason: string | null;
	hasSearchSource: boolean;
}): WatchingPreview["works"][number] {
	const startEpisode =
		member?.startEpisode ?? watchingStartEpisode(entry.progress, backlog);
	let reason = existingReason;
	if (reason === null) {
		if (member?.excluded) reason = "excluded";
		else if (member?.paused) reason = "manually_paused";
		else if (startEpisode === null) reason = "invalid_progress";
		else reason = hasSearchSource ? "will_renew_source" : "will_manage";
	}
	return { workKey: entry.workKey, title: entry.title, startEpisode, reason };
}
