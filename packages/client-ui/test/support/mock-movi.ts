import type { PlayerState } from "movi-player/element";
import { vi } from "vitest";

type Listener = (...args: unknown[]) => void;

/** Drives the public engine boundary; real-browser checks cover decoding and native controls. */
export class MockMoviCore {
	readonly listeners = new Map<string, Set<Listener>>();
	state: PlayerState = "ready";
	activeAudioId = 1;
	readonly trackManager = {
		getActiveAudioTrack: () => ({ id: this.activeAudioId, language: "jpn" }),
	};
	constructor(readonly element: MockMoviElement) {}
	on(event: string, listener: Listener) {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(listener);
		this.listeners.set(event, listeners);
		return () => listeners.delete(listener);
	}
	emit(event: string, ...args: unknown[]) {
		for (const listener of this.listeners.get(event) ?? []) listener(...args);
	}
	setState(state: PlayerState) {
		this.state = state;
		this.element.dispatchEvent(
			new CustomEvent("statechange", { detail: state }),
		);
		this.emit("stateChange", state);
	}
	getState() {
		return this.state;
	}
	getCurrentTime() {
		return this.element.video.currentTime;
	}
	getDuration() {
		return Number.isFinite(this.element.video.duration)
			? this.element.video.duration
			: 0;
	}
	getPlaybackRate() {
		return this.element.video.playbackRate;
	}
	play = vi.fn(async () => {
		await this.element.video.play();
		this.setState("playing");
	});
	seek = vi.fn(async (seconds: number) => {
		this.emit("seeking", seconds);
		this.element.video.currentTime = seconds;
		this.emit("seeked", seconds);
	});
	selectAudioTrack = vi.fn((id: number) => {
		this.activeAudioId = id;
		this.element.dispatchEvent(new Event("audiotrackchange"));
		return true;
	});
	getAudioTracks() {
		return [1, 2].map((id) => ({ id, type: "audio", language: "jpn" }));
	}
	getSubtitleTracks() {
		return [];
	}
	getChapters() {
		return [];
	}
}

export class MockMoviElement extends HTMLElement {
	static instances: MockMoviElement[] = [];
	static observedAttributes = ["src"];
	readonly video = document.createElement("video");
	player: MockMoviCore | null = new MockMoviCore(this);
	private source: string | File | null = null;
	private connected = false;
	setHostFullscreen = vi.fn();
	appendSubtitleCues = vi.fn();
	removeSubtitleCues = vi.fn();
	constructor() {
		super();
		MockMoviElement.instances.push(this);
		for (const [native, state] of [
			["playing", "playing"],
			["pause", "paused"],
			["waiting", "buffering"],
		] as const)
			this.video.addEventListener(native, () => this.player?.setState(state));
		this.video.addEventListener("loadedmetadata", () => {
			this.player?.emit("loadEnd");
			this.dispatchEvent(new Event("loadedmetadata"));
		});
		for (const event of ["seeking", "seeked", "timeupdate"])
			this.video.addEventListener(event, () => {
				// Native fixtures set currentTime and dispatch seeked to represent a complete seek.
				if (event === "seeked")
					this.player?.emit("seeking", this.video.currentTime);
				this.player?.emit(
					event === "timeupdate" ? "timeUpdate" : event,
					this.video.currentTime,
				);
			});

		this.video.addEventListener("ended", () => {
			this.player?.setState("ended");
			this.player?.emit("ended");
			this.dispatchEvent(new Event("ended"));
		});
		this.video.addEventListener("error", () => {
			this.player?.setState("error");
			// Movi forwards core errors before the app attaches its clock listeners.
			this.dispatchEvent(
				new CustomEvent("error", { detail: this.video.error }),
			);
			this.player?.emit("error", this.video.error);
		});

		this.video.addEventListener("ratechange", () =>
			this.dispatchEvent(new Event("ratechange")),
		);
	}
	attributeChangedCallback(
		name: string,
		_old: string | null,
		value: string | null,
	) {
		if (name !== "src") return;
		this.source = value;
		if (value) this.video.setAttribute("src", this.sourcePath(value));
		else this.video.removeAttribute("src");
	}
	connectedCallback() {
		if (this.connected) return;
		this.connected = true;
		this.video.setAttribute(
			"aria-label",
			`Video: ${this.closest("section")?.getAttribute("aria-label") ?? ""}`,
		);
		this.append(this.video);
		if (this.source)
			this.video.setAttribute("src", this.sourcePath(this.source));
		queueMicrotask(() => {
			if (this.isConnected && this.player)
				this.dispatchEvent(new Event("loadeddata"));
		});
	}
	disconnectedCallback() {
		this.video.removeAttribute("src");
		this.video.pause();
		this.video.load();
		this.player = null;
	}
	private sourcePath(source: string | File) {
		return typeof source === "string"
			? new URL(source, "http://localhost").pathname
			: source.name;
	}
	get src() {
		return this.source;
	}
	set src(source: string | File | null) {
		this.source = source;
		if (source) this.video.setAttribute("src", this.sourcePath(source));
		else {
			this.removeAttribute("src");
			this.video.removeAttribute("src");
			this.player = null;
		}
	}
	get volume() {
		return this.video.volume;
	}
	set volume(value: number) {
		this.video.volume = value;
	}
	get currentTime() {
		return this.video.currentTime;
	}
	set currentTime(seconds: number) {
		void this.player?.seek(seconds);
	}
	play() {
		return this.player?.play() ?? Promise.resolve();
	}
	pause() {
		this.video.pause();
		this.player?.setState("paused");
	}
}

if (!customElements.get("mock-movi-player"))
	customElements.define("mock-movi-player", MockMoviElement);

vi.mock(
	"../../src/features/playback/player/movi.js",
	async (importOriginal) => {
		const original =
			await importOriginal<
				typeof import("../../src/features/playback/player/movi.js")
			>();
		return {
			...original,
			loadPlayer: async () => ({ MoviElement: MockMoviElement }),
		};
	},
);
