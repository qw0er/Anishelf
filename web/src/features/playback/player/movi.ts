import type { MoviElement, PlayerEventMap } from "movi-player/element";
import type { PlaybackClock } from "./engine.js";

type PlayerModule = typeof import("movi-player/element/slim");
type MoviCore = NonNullable<MoviElement["player"]>;
let modulePromise: Promise<PlayerModule> | undefined;

export function loadPlayer(): Promise<PlayerModule> {
	modulePromise ??= import("movi-player/element/slim")
		.then((module) => {
			// Upstream diagnostics can include private media URLs. Log IDs in the application instead.
			module.Logger.setLevel(module.LogLevel.SILENT);
			console.info("[playback] Movi module loaded.");
			return module;
		})
		.catch((error) => {
			modulePromise = undefined;
			console.error("[playback] Movi module failed to load.");
			throw error;
		});
	return modulePromise;
}

/** One loaded Movi core, bridged to the application's millisecond clock. */
export class MoviClock extends EventTarget implements PlaybackClock {
	private position = 0;
	private restoredPosition: number | null = null;
	private started = false;
	private disposed = false;
	private pendingSeek: Promise<void> = Promise.resolve();
	private seekError: unknown;
	private seekGeneration = 0;
	private activeSeek = 0;
	private acknowledgeSeek: (() => void) | undefined;
	private readonly detach: (() => void)[] = [];
	private readonly originalPlay: MoviCore["play"];
	private readonly playBridge: MoviCore["play"];
	private isPaused = true;
	ended = false;
	seeking = false;
	readonly player: MoviCore;
	readonly element: MoviElement;

	constructor(element: MoviElement, player = element.player) {
		super();
		if (!player) throw new Error("Movi has no loaded playback core.");
		this.element = element;
		this.player = player;
		this.isPaused = player.getState() !== "playing";
		this.originalPlay = player.play;
		this.playBridge = async () => {
			await this.waitForSeek();
			if (this.disposed) return;
			if (this.seekError) throw this.seekError;
			if (
				this.ended ||
				(this.restoredPosition !== null &&
					this.durationMs > 0 &&
					this.restoredPosition >= this.durationMs - 100)
			) {
				this.currentTimeMs = 0;
				await this.waitForSeek();
				if (this.disposed) return;
				if (this.seekError) throw this.seekError;
			}
			await this.originalPlay.call(player);
		};
		// Movi's own controls and recovery paths call the core, not always the element.
		player.play = this.playBridge;
		const bind = <K extends keyof PlayerEventMap>(
			event: K,
			handler: (value: PlayerEventMap[K]) => void,
		) => {
			this.detach.push(player.on(event, handler));
		};
		bind("stateChange", (state) => {
			if (state === "playing") {
				this.started = true;
				this.restoredPosition = null;
				this.isPaused = false;
				this.ended = false;
				this.emit("playing");
			} else if (state === "paused" || state === "ready") {
				this.isPaused = true;
				if (state === "paused") this.emit("pause");
			} else if (state === "buffering" || state === "loading") {
				this.emit("waiting");
			} else if (state === "seeking") {
				if (this.activeSeek === 0)
					this.position = milliseconds(player.getCurrentTime());
				this.beginSeek();
			} else if (state === "error") {
				this.isPaused = true;
				this.emit("waiting");
			}
		});
		bind("timeUpdate", () => this.emit("timeupdate"));
		bind("loadEnd", () => this.emit("loadedmetadata"));
		bind("seeking", (seconds) => {
			if (this.activeSeek === 0 || this.activeSeek === this.seekGeneration) {
				this.position = milliseconds(seconds);
				if (!this.started) this.restoredPosition = this.position;
			}
			this.beginSeek();
		});
		bind("seeked", () => {
			this.acknowledgeSeek?.();
			// A newer queued seek must not be acknowledged by an older completion.
			if (this.activeSeek !== 0 && this.activeSeek !== this.seekGeneration)
				return;
			this.finishSeek();
		});
		bind("seekcomplete", () => {
			// First-play alignment and decoder recovery suppress public seeked, but
			// their stateChange still interrupts playback evidence and must settle.
			if (this.activeSeek === 0) this.finishSeek();
		});
		bind("ended", () => {
			this.ended = true;
			this.isPaused = true;
			this.position = this.durationMs;
			this.emit("ended");
		});
		bind("error", (error) => {
			this.seekError = error;
			this.acknowledgeSeek?.();
			this.isPaused = true;
			this.emit("waiting");
			this.emit("error");
		});
		const rate = () => this.emit("ratechange");
		element.addEventListener("ratechange", rate);
		this.detach.push(() => element.removeEventListener("ratechange", rate));
	}

	get paused() {
		return this.isPaused;
	}
	get readyState() {
		const state = this.player.getState();
		return state === "idle" || state === "loading" || state === "error" ? 0 : 1;
	}
	get currentTimeMs() {
		if (this.ended) return this.durationMs;
		if (this.seeking) return this.position;
		return milliseconds(this.player.getCurrentTime());
	}
	set currentTimeMs(value: number) {
		if (!Number.isFinite(value)) throw new Error("Invalid playback position.");
		if (this.disposed) return;
		const position = Math.max(0, Math.round(value));
		const wasEnded = this.ended || this.player.getState() === "ended";
		const generation = ++this.seekGeneration;
		this.position = position;
		this.seekError = undefined;
		if (!this.started) this.restoredPosition = position;
		this.beginSeek();
		this.pendingSeek = this.pendingSeek.then(async () => {
			if (this.disposed) return;
			this.activeSeek = generation;
			this.seekError = undefined;
			try {
				// Initial zero-position restoration needs no decoder seek. A completed
				// replay still goes through seek even if the engine has reset its clock.
				const state = this.player.getState();
				if (state === "idle" || state === "loading" || state === "error")
					throw new Error("Movi is not ready to seek the selected resource.");
				if (
					!wasEnded &&
					(state === "ready" || state === "paused") &&
					milliseconds(this.player.getCurrentTime()) === position
				) {
					if (generation === this.seekGeneration) this.finishSeek();
					return;
				}
				const acknowledged = new Promise<void>((resolve) => {
					this.acknowledgeSeek = resolve;
				});
				await this.player.seek(position / 1000);
				// In Movi 0.4.1 the promise only initiates decoding; seeked is the
				// actual positioning acknowledgement. An error or disposal releases it.
				if (this.player.getState() === "error" && !this.seekError)
					throw new Error("Movi could not seek the selected resource.");
				await acknowledged;
				if (!this.disposed && generation === this.seekGeneration) {
					if (this.seekError) throw this.seekError;
					this.finishSeek();
				}
			} catch (error) {
				if (!this.disposed && generation === this.seekGeneration) {
					const reported = this.seekError === error;
					this.seekError = error;
					this.seeking = false;
					if (!reported) this.emit("error");
				}
			} finally {
				this.activeSeek = 0;
				this.acknowledgeSeek = undefined;
			}
		});
	}
	get durationMs() {
		return milliseconds(this.player.getDuration());
	}
	get playbackRate() {
		return this.player.getPlaybackRate();
	}
	play() {
		return this.element.play();
	}
	dispose() {
		this.disposed = true;
		this.acknowledgeSeek?.();
		if (this.player.play === this.playBridge)
			this.player.play = this.originalPlay;
		for (const detach of this.detach) detach();
		this.detach.length = 0;
	}
	private emit(event: string) {
		if (!this.disposed) this.dispatchEvent(new Event(event));
	}
	private beginSeek() {
		this.ended = false;
		if (!this.seeking) {
			this.seeking = true;
			this.emit("seeking");
		}
	}
	private finishSeek() {
		if (!this.seeking) return;
		this.seeking = false;
		this.emit("seeked");
	}
	private async waitForSeek() {
		let pending: Promise<void>;
		do {
			pending = this.pendingSeek;
			await pending;
		} while (pending !== this.pendingSeek);
	}
}

function milliseconds(seconds: number) {
	return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
}
