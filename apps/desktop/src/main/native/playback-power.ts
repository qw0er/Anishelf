import type { PowerSaveBlocker } from "electron";

export class PlaybackPower {
	private playing = false;
	private blockerId: number | undefined;

	constructor(
		private readonly powerSaveBlocker: Pick<PowerSaveBlocker, "start" | "stop">,
		private hidden: boolean,
	) {}

	setPlaying(playing: boolean) {
		this.playing = playing;
		this.update();
	}

	setHidden(hidden: boolean) {
		this.hidden = hidden;
		this.update();
	}

	private update() {
		const keepAwake = this.playing && !this.hidden;
		try {
			if (keepAwake && this.blockerId === undefined) {
				this.blockerId = this.powerSaveBlocker.start("prevent-display-sleep");
				console.debug("desktop.playback_power_started");
			} else if (!keepAwake && this.blockerId !== undefined) {
				this.powerSaveBlocker.stop(this.blockerId);
				this.blockerId = undefined;
				console.debug("desktop.playback_power_stopped");
			}
		} catch (error) {
			console.warn("desktop.playback_power_blocker_failed", {
				keepAwake,
				error,
			});
		}
	}
}
