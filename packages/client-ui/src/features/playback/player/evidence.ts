/** Cooperative normal-play time for one session. Seeks, pauses and buffering break continuity. */
export class PlaybackEvidence {
	private anchor: { position: number; time: number; rate: number } | null =
		null;
	private normalMs = 0;
	reset() {
		this.anchor = null;
	}
	sample(position: number, rate: number, now = performance.now()): void {
		const previous = this.anchor;
		if (previous) {
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
		this.anchor = { position, time: now, rate };
	}
	get normalPlayedMs(): number {
		return Math.floor(this.normalMs);
	}
}
