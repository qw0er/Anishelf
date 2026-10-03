import { styledSubtitleFormats } from "@anishelf/backend/contracts/subtitles";
import type { TextRenderer, TextTrack } from "@vidstack/react";
import type JASSUB from "jassub";
import fallbackFont from "jassub/dist/default.woff2?url";
import type { SubtitlePolicy } from "../../config/media-policy.js";

/** Bridges JASSUB 2's promise API to Vidstack's renderer lifecycle. */
export class StyledSubtitleRenderer implements TextRenderer {
	readonly priority = 0;
	private readonly policy: SubtitlePolicy;
	constructor(policy: SubtitlePolicy) {
		this.policy = policy;
	}
	private video: HTMLVideoElement | null = null;
	private track: TextTrack | null = null;
	private stop: (() => void) | null = null;

	canRender(track: TextTrack, video: HTMLVideoElement | null) {
		return (
			!!video &&
			!!track.src &&
			this.policy.formats.includes(track.type as "ass" | "ssa") &&
			typeof track.type === "string" &&
			styledSubtitleFormats.includes(track.type)
		);
	}
	attach(video: HTMLVideoElement | null) {
		this.detach();
		this.video = video;
	}
	detach() {
		this.stop?.();
		this.stop = null;
		this.track = null;
		this.video = null;
	}
	changeTrack(track: TextTrack | null) {
		if (track === this.track) return;
		this.stop?.();
		this.stop = null;
		this.track = track;
		const video = this.video;
		const src = track?.src;
		if (!track || !src || !video) return;
		const controller = new AbortController();
		let instance: JASSUB | null = null;
		const stop = () => {
			controller.abort();
			clearTimeout(timer);
			video.removeEventListener("seeked", repaint);
			video.removeEventListener("pause", repaint);
			video.removeEventListener("loadeddata", repaint);
			void instance?.destroy().catch(() => {});
		};
		const fail = () => {
			if (controller.signal.aborted) return;
			stop();
			track.mode = "disabled";
		};
		const paint = async () => {
			if (!instance || controller.signal.aborted || !video.videoWidth) return;
			await instance.manualRender(
				{
					expectedDisplayTime: performance.now(),
					width: video.videoWidth,
					height: video.videoHeight,
					mediaTime: video.currentTime,
				},
				true,
			);
		};
		const repaint = () => {
			void paint().catch(fail);
		};
		const timer = setTimeout(fail, this.policy.initializationTimeoutMs);
		this.stop = stop;
		void (async () => {
			const response = await fetch(src, { signal: controller.signal });
			if (!response.ok) throw new Error("Subtitle unavailable.");
			const text = await response.text();
			if (!/^\s*\[Events\]/im.test(text) || !/^Dialogue\s*:/im.test(text))
				throw new Error("No subtitle events.");
			const { default: Renderer } = await import("jassub");
			if (controller.signal.aborted) return;
			if (!HTMLCanvasElement.prototype.transferControlToOffscreen)
				throw new Error("OffscreenCanvas is unavailable.");
			instance = new Renderer({
				video,
				subContent: text,
				fonts: [fallbackFont],
				queryFonts: false,
				libassMemoryLimit: this.policy.memoryMaximumBytes,
			});
			await instance.ready;
			if (controller.signal.aborted) return;
			video.addEventListener("seeked", repaint);
			video.addEventListener("pause", repaint);
			video.addEventListener("loadeddata", repaint);
			await paint();
			clearTimeout(timer);
		})().catch(fail);
	}
}
