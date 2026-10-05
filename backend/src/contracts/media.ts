import type { Static } from "typebox";
import type { MediaTimelineSchema } from "./schemas/media.js";

export type MediaTimeline = Static<typeof MediaTimelineSchema>;

export function sourceTimeMs(
	mediaTimeMs: number,
	timeline: MediaTimeline,
): number {
	return boundedTime(
		mediaTimeMs - timeline.mediaOriginMs + timeline.sourceOriginMs,
		timeline.sourceDurationMs,
	);
}
export function mediaTimeMs(
	sourcePositionMs: number,
	timeline: MediaTimeline,
): number {
	return Math.max(
		0,
		boundedTime(sourcePositionMs, timeline.sourceDurationMs) -
			timeline.sourceOriginMs +
			timeline.mediaOriginMs,
	);
}
function boundedTime(value: number, durationMs: number | null): number {
	if (!Number.isFinite(value)) throw new RangeError("Invalid media time.");
	const position = Math.max(0, Math.round(value));
	return durationMs === null ? position : Math.min(position, durationMs);
}
export function originalTimeline(
	sourceDurationMs: number | null = null,
): MediaTimeline {
	return { sourceOriginMs: 0, mediaOriginMs: 0, sourceDurationMs };
}
