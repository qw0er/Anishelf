/** Cooperative normal-play time for one session. Seeks, pauses and buffering break continuity. */
export class PlaybackEvidence {
	private anchor: { position: number; time: number; rate: number } | null =
		null;
	private normalMs = 0;
	reset() {
		this.anchor = null;
	}
	sample(
		video: HTMLVideoElement,
		playing: boolean,
		now = performance.now(),
	): void {
		const position = video.currentTime * 1000,
			rate = video.playbackRate;
		const previous = this.anchor;
		if (previous && playing && !video.seeking) {
			const elapsed = now - previous.time,
				delta = position - previous.position;
			if (
				elapsed > 0 &&
				elapsed <= 5000 &&
				delta > 0 &&
				delta <= elapsed * previous.rate + 100 &&
				rate === previous.rate
			)
				this.normalMs += elapsed;
		}
		this.anchor =
			playing && !video.seeking ? { position, time: now, rate } : null;
	}
	get normalPlayedMs(): number {
		return Math.floor(this.normalMs);
	}
}
