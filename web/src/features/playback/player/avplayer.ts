import type AVPlayerUI from "@libmedia/avplayer-ui";
import type { PlaybackClock } from "./engine.js";

const playerBase = "/libmedia/1.3.1/";
const decoders: Record<number, string> = {
	27: "h264",
	173: "hevc",
	225: "av1",
	139: "vp8",
	167: "vp9",
	86018: "aac",
	86017: "mp3",
	86076: "opus",
	86021: "vorbis",
	86028: "flac",
	86019: "ac3",
	86056: "eac3",
	86020: "dca",
};
export function decoderResource(
	type: string,
	codec?: number,
	mediaType?: number,
): string {
	// Subtitle decoding/rendering is implemented in the player JS chunks, not Wasm.
	if (type === "decoder" && mediaType === 3) return "";
	if (type !== "decoder") {
		const name =
			type === "resampler"
				? "resample"
				: type === "stretchpitcher"
					? "stretchpitch"
					: null;
		if (!name) throw new Error("Unsupported playback resource.");
		return `${playerBase}${name}/${name}.wasm`;
	}
	const name =
		codec !== undefined && codec >= 65536 && codec <= 65572
			? "pcm"
			: decoders[codec ?? -1];
	if (!name) throw new Error("Unsupported media codec.");
	return `${playerBase}decode/${name}.wasm`;
}
let modulePromise: Promise<typeof AVPlayerUI> | undefined;
export function loadPlayer(): Promise<typeof AVPlayerUI> {
	if (modulePromise) return modulePromise;
	modulePromise = import("@libmedia/avplayer-ui")
		.then(({ default: player }) => {
			// Upstream info dumps include full media URLs. Application diagnostics use IDs only.
			player.setLogLevel(5);
			console.info("[playback] Player module loaded.");
			return player;
		})
		.catch((error) => {
			modulePromise = undefined;
			console.error("[playback] Player module failed to load.");
			throw error;
		});
	return modulePromise;
}
/** Bridges native player events; no polling or synthetic video element. */
export class AVPlayerClock extends EventTarget implements PlaybackClock {
	private position = 0;
	private started = false;
	private restoredPosition: number | null = null;
	private pendingSeek: Promise<void> = Promise.resolve();
	private readonly originalPlay: AVPlayerUI["play"];
	private readonly playBridge: AVPlayerUI["play"];
	paused = true;
	ended = false;
	seeking = false;
	readyState = 0;
	private detached: (() => void)[] = [];
	readonly player: AVPlayerUI;
	constructor(player: AVPlayerUI) {
		super();
		this.player = player;
		this.originalPlay = player.play;
		// Upstream controls call the instance directly; serialize that first play with resume seeking.
		this.playBridge = (options) =>
			this.pendingSeek.then(async () => {
				// A completed history entry must start a replay, rather than initializing decoders at EOF.
				if (
					this.restoredPosition !== null &&
					this.durationMs > 0 &&
					this.restoredPosition >= this.durationMs - 100
				) {
					this.currentTimeMs = 0;
					await this.pendingSeek;
				}
				return this.originalPlay.call(player, options);
			});
		player.play = this.playBridge;
		const bind = (event: string, handler: (...args: unknown[]) => void) => {
			player.on(event, handler);
			this.detached.push(() => player.off(event, handler));
		};
		const emit = (name: string) => this.dispatchEvent(new Event(name));
		bind("loaded", () => {
			this.readyState = 1;
			emit("loadedmetadata");
		});
		bind("time", (...args) => {
			const pts = args.find(
				(x) => typeof x === "bigint" || typeof x === "number",
			);
			if (pts !== undefined) this.position = Number(pts);
			emit("timeupdate");
		});
		bind("played", () => {
			this.started = true;
			this.restoredPosition = null;
			this.paused = false;
			this.ended = false;
			emit("playing");
		});
		bind("playing", () => {
			this.paused = false;
			this.ended = false;
			emit("playing");
		});
		bind("paused", () => {
			this.paused = true;
			emit("pause");
		});
		bind("ended", () => {
			this.ended = true;
			this.paused = true;
			this.position = this.durationMs;
			emit("ended");
		});
		bind("seeking", () => {
			this.ended = false;
			this.seeking = true;
			emit("seeking");
		});
		bind("seeked", () => {
			this.seeking = false;
			emit("seeked");
		});
		bind("stutter", () => emit("waiting"));
		bind("error", () => {
			this.paused = true;
			emit("waiting");
		});
	}
	get currentTimeMs() {
		return this.ended
			? this.durationMs
			: this.restoredPosition !== null &&
					!this.started &&
					this.player.getStatus() === 4
				? this.restoredPosition
				: this.seeking
					? this.position
					: Number(this.player.currentTime);
	}
	set currentTimeMs(value: number) {
		this.ended = false;
		this.position = value;
		if (!this.started) this.restoredPosition = value;
		this.seeking = true;
		this.dispatchEvent(new Event("seeking"));
		this.pendingSeek = this.player.seek(BigInt(Math.round(value))).catch(() => {
			this.seeking = false;
			this.dispatchEvent(new Event("error"));
		});
	}
	get durationMs() {
		return Number(this.player.getDuration());
	}
	get playbackRate() {
		return this.player.getPlaybackRate();
	}
	play() {
		return this.player.play();
	}
	dispose() {
		if (this.player.play === this.playBridge)
			this.player.play = this.originalPlay;
		for (const detach of this.detached) detach();
		this.detached = [];
	}
}
