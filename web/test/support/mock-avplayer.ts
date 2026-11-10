import type AVPlayerUI from "@libmedia/avplayer-ui";
import { vi } from "vitest";

/** Browser decoding is covered by real-browser smoke checks; app tests drive the engine boundary. */
class MockAVPlayer {
	readonly video: HTMLVideoElement;
	readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
	constructor(options: { container: HTMLDivElement }) {
		this.video = document.createElement("video");
		this.video.setAttribute(
			"aria-label",
			`Video: ${options.container.parentElement?.getAttribute("aria-label") ?? ""}`,
		);
		options.container.append(this.video);
		for (const [native, engine] of [
			["loadedmetadata", "loaded"],
			["timeupdate", "time"],
			["playing", "played"],
			["pause", "paused"],
			["seeking", "seeking"],
			["seeked", "seeked"],
			["ended", "ended"],
			["error", "error"],
		] as const)
			this.video.addEventListener(native, () =>
				this.emit(
					engine,
					native === "error" ? this.video.error : this.currentTime,
				),
			);
	}
	on(event: string, fn: (...args: unknown[]) => void) {
		const set = this.listeners.get(event) ?? new Set();
		set.add(fn);
		this.listeners.set(event, set);
	}
	off(event: string, fn: (...args: unknown[]) => void) {
		this.listeners.get(event)?.delete(fn);
	}
	emit(event: string, ...args: unknown[]) {
		for (const fn of this.listeners.get(event) ?? []) fn(...args);
	}
	get currentTime() {
		return BigInt(Math.round(this.video.currentTime * 1000));
	}
	getDuration() {
		return BigInt(
			Math.round(
				(Number.isFinite(this.video.duration) ? this.video.duration : 0) * 1000,
			),
		);
	}
	getPlaybackRate() {
		return this.video.playbackRate;
	}
	getStatus() {
		// This native-element stand-in already has an initialized render clock.
		return 6;
	}
	async load(url: string) {
		this.video.setAttribute("src", new URL(url, "http://localhost").pathname);
	}
	async play() {
		await this.video.play();
		this.emit("played");
	}
	async pause() {
		this.video.pause();
		this.emit("paused");
	}
	async seek(value: bigint) {
		this.video.currentTime = Number(value) / 1000;
		this.emit("seeked");
	}
	async selectAudio() {}
	getSelectedAudioStreamId() {
		return 1;
	}
	getStreams() {
		return [
			{ index: 0, id: 0 },
			{ index: 1, id: 1 },
			{ index: 2, id: 2 },
		];
	}
	setVolume(value: number) {
		this.video.volume = value;
	}
	getVolume() {
		return this.video.volume;
	}
	async destroy() {
		this.video.removeAttribute("src");
		this.video.pause();
		this.video.load();
		this.video.remove();
	}
}
vi.mock(
	"../../src/features/playback/player/avplayer.js",
	async (importOriginal) => {
		const original =
			await importOriginal<
				typeof import("../../src/features/playback/player/avplayer.js")
			>();
		return {
			...original,
			loadPlayer: async () => MockAVPlayer as unknown as typeof AVPlayerUI,
		};
	},
);
