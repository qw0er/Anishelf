import {
	type MediaTimeline,
	mediaTimeMs,
} from "@anishelf/backend/contracts/media";
import type AVPlayerUI from "@libmedia/avplayer-ui";
import type { ChaptersResponse } from "../../../shared/api/contracts.js";

export interface PlayerChapter {
	id: string;
	startMs: number;
	title: string | null;
}

/** Engine chapters already use the loaded asset's timeline, including prepared copies. */
export function playerChapters(
	chapters: ReturnType<AVPlayerUI["getChapters"]>,
): PlayerChapter[] {
	return chapters
		.flatMap((chapter) => {
			const { num, den } = chapter.timeBase;
			if (
				num <= 0 ||
				den <= 0 ||
				!Number.isInteger(num) ||
				!Number.isInteger(den)
			)
				return [];
			const startMs = Number(
				(chapter.start * BigInt(num) * 1000n) / BigInt(den),
			);
			if (!Number.isSafeInteger(startMs) || startMs < 0) return [];
			return [
				{
					id: chapter.id.toString(),
					startMs,
					title:
						typeof chapter.metadata.title === "string"
							? chapter.metadata.title.trim() || null
							: null,
				},
			];
		})
		.sort((a, b) => a.startMs - b.startMs);
}

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
