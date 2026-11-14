import { type MediaTimeline, sourceTimeMs } from "@anishelf/contracts/media";
import type { SavePlaybackProgressRequest } from "../../../shared/api/contracts.js";
import type { PlaybackClock } from "./engine.js";

export type Position = Pick<
	SavePlaybackProgressRequest,
	"positionMs" | "durationMs"
>;

export function capturePlaybackPosition(
	video: Pick<PlaybackClock, "durationMs" | "currentTimeMs">,
	timeline: MediaTimeline,
	ended: boolean,
): Position | null {
	const durationMs =
		timeline.sourceDurationMs ??
		(timeline.sourceOriginMs === 0 &&
		timeline.mediaOriginMs === 0 &&
		Number.isFinite(video.durationMs) &&
		video.durationMs > 0
			? Math.round(video.durationMs)
			: null);
	const localPosition =
		ended && Number.isFinite(video.durationMs)
			? video.durationMs
			: video.currentTimeMs;
	const positionMs = sourceTimeMs(localPosition, timeline);
	if (
		!Number.isSafeInteger(positionMs) ||
		positionMs < 0 ||
		(durationMs !== null &&
			(!Number.isSafeInteger(durationMs) || durationMs <= 0))
	)
		return null;
	return {
		positionMs:
			durationMs === null ? positionMs : Math.min(positionMs, durationMs),
		durationMs,
	};
}
