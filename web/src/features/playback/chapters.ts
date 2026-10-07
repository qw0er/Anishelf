import {
	type MediaTimeline,
	mediaTimeMs,
} from "@anishelf/backend/contracts/media";
import type { ChaptersResponse } from "../../api/contracts.js";

/** Clip in source time before mapping; clamping both endpoints would invent chapters. */
export function chapterCues(
	chapters: ChaptersResponse["chapters"],
	timeline: MediaTimeline,
) {
	return chapters.flatMap((chapter, index) => {
		const start = Math.max(chapter.startMs, timeline.sourceOriginMs);
		const end = Math.min(
			chapter.endMs,
			timeline.sourceDurationMs ?? chapter.endMs,
		);
		if (end <= start) return [];
		return [
			{
				startTime: mediaTimeMs(start, timeline) / 1000,
				endTime: mediaTimeMs(end, timeline) / 1000,
				text: chapter.title ?? `Chapter ${index + 1}`,
			},
		];
	});
}
