import type { EmbeddedSubtitleResponse } from "@anishelf/contracts/http";
import { type MediaTimeline, sourceTimeMs } from "@anishelf/contracts/media";
import type JASSUB from "jassub";
import type { MoviElement } from "movi-player/element";
import type { ExternalSubtitles } from "./subtitles.js";

interface StyledSubtitleBinding {
	fileId: string;
	sourceVersion: string;
	assetId: string;
	assetRevision: string;
}

/** Retains successful font reads for the selected playback asset. */
export function embeddedSubtitleReader(binding: StyledSubtitleBinding) {
	const fonts = new Map<number, Uint8Array<ArrayBuffer>>();
	const { fileId, sourceVersion, assetId, assetRevision } = binding;
	const query = new URLSearchParams({ sourceVersion, assetId, assetRevision });
	const root = `/api/files/${encodeURIComponent(fileId)}/subtitles`;
	return async (index: number, signal: AbortSignal) => {
		const response = await fetch(`${root}/embedded/${index}?${query}`, {
			signal,
		});
		if (!response.ok) throw new Error("Embedded subtitle unavailable.");
		const { text, fonts: descriptors }: EmbeddedSubtitleResponse =
			await response.json();
		const available: Uint8Array<ArrayBuffer>[] = [];
		for (const { index: fontIndex, sizeBytes } of descriptors) {
			try {
				let font = fonts.get(fontIndex);
				if (!font) {
					const fontResponse = await fetch(
						`${root}/fonts/${fontIndex}?${query}`,
						{ signal },
					);
					if (!fontResponse.ok) throw new Error("Subtitle font unavailable.");
					font = new Uint8Array(await fontResponse.arrayBuffer());
					signal.throwIfAborted();
					if (font.byteLength !== sizeBytes)
						throw new Error("Subtitle font size changed.");
					fonts.set(fontIndex, font);
				}
				available.push(font);
			} catch (error) {
				signal.throwIfAborted();
				console.warn("[playback] Embedded subtitle font unavailable.", {
					fileId,
					assetId,
					fontIndex,
					errorType: error instanceof Error ? error.name : "unknown",
				});
			}
		}
		return { text, fonts: available };
	};
}

/** Layer a canvas beside Movi's subtitle overlay, which Movi can clear while seeking. */
export function attachStyledSubtitles(options: {
	player: MoviElement;
	sidecars: ExternalSubtitles | undefined;
	timeline: MediaTimeline;
	readEmbedded: ReturnType<typeof embeddedSubtitleReader>;
	onFailure: () => void;
}): () => void {
	const { player, sidecars, timeline, readEmbedded, onFailure } = options;
	const core = player.player;
	const root = player.shadowRoot;
	const nativeOverlay = root?.querySelector<HTMLElement>(
		".movi-subtitle-overlay",
	);
	const videoCanvas = root?.querySelector("canvas");
	if (!core || !root || !nativeOverlay || !videoCanvas) return () => {};

	const style = document.createElement("style");
	style.textContent = `
		.movi-subtitle-overlay[data-anishelf-styled] { visibility: hidden !important; }
		:host(.movi-fill-overlay-open) [data-anishelf-ass] { visibility: hidden; }
	`;
	root.append(style);
	let stop: (() => void) | undefined;
	let key: string | undefined;
	let disposed = false;
	const sync = () => {
		if (disposed || player.player !== core) return;
		const external = player.getSubtitleLangs().find((track) => track.active);
		const text = external && sidecars?.styledText(external.lang);
		const embedded = external
			? null
			: core.trackManager.getActiveSubtitleTrack();
		const styled =
			embedded?.codec === "ass" || embedded?.codec === "ssa" ? embedded : null;
		const next = text
			? external?.lang
			: styled
				? `embedded:${styled.id}`
				: undefined;
		if (key === next) return;
		key = next;
		stop?.();
		stop = undefined;
		if (!next) return;

		const abort = new AbortController();
		const { signal } = abort;
		const canvas = document.createElement("canvas");
		const layer = document.createElement("div");
		layer.dataset.anishelfAss = "";
		layer.setAttribute("aria-hidden", "true");
		layer.style.cssText =
			"position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5;visibility:hidden";
		canvas.style.cssText = "position:absolute;pointer-events:none";
		layer.append(canvas);
		root.append(layer);
		let instance: JASSUB | undefined;
		let frame = 0;
		let rendering = false;
		let dirty = true;
		let lastTime = Number.NaN;
		let dimensions = "";
		let ready = false;
		const timeout = setTimeout(fail, 60_000);
		const schedule = () => {
			if (!signal.aborted && ready && !rendering && !frame)
				frame = requestAnimationFrame(() => {
					frame = 0;
					void paint().catch(fail);
				});
		};
		const repaint = () => {
			dirty = true;
			schedule();
		};
		const off = [
			core.on("stateChange", repaint),
			core.on("seeked", repaint),
			core.on("seekcomplete", repaint),
		];
		player.addEventListener("subtitledelaychange", repaint);
		const resize = new ResizeObserver(repaint);
		resize.observe(videoCanvas);
		function cleanup() {
			if (signal.aborted) return;
			abort.abort();
			clearTimeout(timeout);
			cancelAnimationFrame(frame);
			resize.disconnect();
			for (const unsubscribe of off) unsubscribe();
			player.removeEventListener("subtitledelaychange", repaint);
			nativeOverlay?.removeAttribute("data-anishelf-styled");
			layer.remove();
			void instance?.destroy().catch(() => {});
		}
		function fail() {
			if (signal.aborted) return;
			cleanup();
			onFailure();
		}
		const paint = async () => {
			if (!instance || signal.aborted) return;
			const video = core.trackManager.getActiveVideoTrack();
			const areaWidth = videoCanvas?.clientWidth ?? 0;
			const areaHeight = videoCanvas?.clientHeight ?? 0;
			if (!video?.width || !video.height || !areaWidth || !areaHeight) return;
			const fit = player.objectFit;
			const scale = (fit === "cover" || fit === "zoom" ? Math.max : Math.min)(
				areaWidth / video.width,
				areaHeight / video.height,
			);
			const width = Math.round(
				fit === "fill" ? areaWidth : video.width * scale,
			);
			const height = Math.round(
				fit === "fill" ? areaHeight : video.height * scale,
			);
			if (!width || !height) return;
			const size = `${areaWidth}:${areaHeight}:${width}:${height}`;
			const sizeChanged = dimensions !== size;
			if (sizeChanged) {
				dimensions = size;
				canvas.style.width = `${width}px`;
				canvas.style.height = `${height}px`;
				canvas.style.left = `${(areaWidth - width) / 2}px`;
				canvas.style.top = `${(areaHeight - height) / 2}px`;
			}
			const mediaTime = core.getCurrentTime();
			const trackTime =
				(text ? sourceTimeMs(mediaTime * 1000, timeline) / 1000 : mediaTime) -
				player.subtitleDelay;
			if (sizeChanged || dirty || trackTime !== lastTime) {
				const repaintFrame = sizeChanged || dirty;
				dirty = false;
				rendering = true;
				try {
					await instance.manualRender(
						{
							expectedDisplayTime: performance.now(),
							width: video.width,
							height: video.height,
							mediaTime: trackTime,
						},
						repaintFrame,
					);
					if (signal.aborted) return;
					lastTime = trackTime;
					nativeOverlay?.setAttribute("data-anishelf-styled", "");
					layer.style.visibility = "";
				} finally {
					rendering = false;
				}
			}
			if (dirty || core.getState() === "playing") schedule();
		};
		stop = cleanup;
		void (async () => {
			const content = text
				? { text, fonts: [] }
				: styled
					? await readEmbedded(styled.id, signal)
					: null;
			if (!content) throw new Error("Subtitle unavailable.");
			const [{ default: Renderer }, { default: fallbackFont }] =
				await Promise.all([
					import("jassub"),
					import("jassub/dist/default.woff2?url"),
				]);
			signal.throwIfAborted();
			instance = new Renderer({
				canvas,
				subContent: content.text,
				fonts: [...content.fonts, fallbackFont],
				queryFonts: false,
				libassMemoryLimit: 64,
			});
			await instance.ready;
			signal.throwIfAborted();
			ready = true;
			schedule();
			clearTimeout(timeout);
		})().catch(fail);
	};
	// External selection can emit an intermediate embedded-track clear first.
	const changed = () => queueMicrotask(sync);
	player.addEventListener("subtitletrackchange", changed);
	sync();
	return () => {
		disposed = true;
		player.removeEventListener("subtitletrackchange", changed);
		stop?.();
		style.remove();
	};
}
