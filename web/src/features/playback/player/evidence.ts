import {
	type MediaTimeline,
	sourceTimeMs,
} from "@anishelf/backend/contracts/media";

type Interval = {
	startMs: number;
	endMs: number;
	elapsedMs: number;
	rate: number;
};
/** Samples continuity; seeks, buffering, pauses and resource switches break the anchor. */
export class PlaybackEvidence {
	private anchor: { position: number; time: number; rate: number } | null =
		null;
	private intervals: Interval[] = [];
	reset() {
		this.anchor = null;
	}
	sample(
		video: HTMLVideoElement,
		timeline: MediaTimeline,
		playing: boolean,
		now = performance.now(),
	) {
		const position = sourceTimeMs(video.currentTime * 1000, timeline),
			rate = video.playbackRate;
		const previous = this.anchor;
		if (previous && playing && !video.seeking) {
			const elapsedMs = now - previous.time,
				delta = position - previous.position;
			if (
				elapsedMs > 0 &&
				elapsedMs <= 5000 &&
				delta > 0 &&
				delta <= elapsedMs * previous.rate + 100 &&
				rate === previous.rate
			) {
				const last = this.intervals.at(-1);
				if (last && last.endMs === previous.position && last.rate === rate) {
					last.endMs = position;
					last.elapsedMs += elapsedMs;
				} else if (this.intervals.length < 128)
					this.intervals.push({
						startMs: previous.position,
						endMs: position,
						elapsedMs,
						rate,
					});
			}
		}
		this.anchor =
			playing && !video.seeking ? { position, time: now, rate } : null;
	}
	take(): Interval[] {
		const result = this.intervals;
		this.intervals = [];
		return result;
	}
}
