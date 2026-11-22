import { type MediaTimeline, sourceTimeMs } from "@anishelf/contracts/media";
import type { SavePlaybackProgressRequest } from "../../../shared/api/contracts.js";

export type Position = Pick<
	SavePlaybackProgressRequest,
	"positionMs" | "durationMs"
>;

export function capturePlaybackPosition(
	progress: { durationMs: number | null; positionMs: number },
	timeline: MediaTimeline,
	ended: boolean,
): Position | null {
	const durationMs =
		timeline.sourceDurationMs ??
		(timeline.sourceOriginMs === 0 &&
		timeline.mediaOriginMs === 0 &&
		progress.durationMs !== null &&
		Number.isFinite(progress.durationMs) &&
		progress.durationMs > 0
			? Math.round(progress.durationMs)
			: null);
	const localPosition = ended
		? (progress.durationMs ?? progress.positionMs)
		: progress.positionMs;
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
