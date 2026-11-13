import { type MediaTimeline, mediaTimeMs } from "@anishelf/contracts/media";
import { parse } from "ass-compiler";
import type { MoviElement, SubtitleCue } from "movi-player/element";
import { discoverSubtitles } from "../../media/public.js";

/** Movi's text renderer recognizes HTML-like formatting after decoding entities. */
function plainSubtitleText(text: string): string {
	return text
		.replace(/\\[Nn]/g, "\n")
		.replace(/\\h/g, "\u00a0")
		.replace(/&(?:amp;)*(?:lt|#0*60|#x0*3c);/gi, "<")
		.replace(/&(?:amp;)*(?:gt|#0*62|#x0*3e);/gi, ">")
		.replace(/<[^>]*>/g, "")
		.trim();
}

/** ASS/SSA is deliberately reduced to dialogue and timing, without styles or drawings. */
export function assSubtitleCues(
	contents: string,
	timeline: MediaTimeline,
): SubtitleCue[] {
	return parse(contents)
		.events.dialogue.flatMap((dialogue) => {
			if (
				!Number.isFinite(dialogue.Start) ||
				!Number.isFinite(dialogue.End) ||
				dialogue.Start < 0 ||
				dialogue.End <= dialogue.Start
			)
				return [];
			const startMs = Math.max(dialogue.Start * 1000, timeline.sourceOriginMs);
			const endMs = Math.min(
				dialogue.End * 1000,
				timeline.sourceDurationMs ?? Number.POSITIVE_INFINITY,
			);
			const text = plainSubtitleText(dialogue.Text.combined);
			if (endMs <= startMs || !text) return [];
			return [
				{
					start: mediaTimeMs(startMs, timeline) / 1000,
					end: mediaTimeMs(endMs, timeline) / 1000,
					text,
				},
			];
		})
		.sort((a, b) => a.start - b.start);
}

/** Keep VTT/SRT parsing upstream-owned; normalize its supported timestamp spelling. */
function nativeSubtitleText(contents: string): string {
	return contents
		.replace(/\r\n?/g, "\n")
		.replace(
			/^(\d{2}:\d{2}[.,]\d{3})(\s*-->\s*)(\d{2}:\d{2}[.,]\d{3})/gm,
			"00:$1$200:$3",
		);
}

type SubtitleElement = Pick<
	MoviElement,
	"appendSubtitleCues" | "removeSubtitleCues"
>;
export interface ExternalSubtitles {
	tracks: HTMLTrackElement[];
	hasAss: boolean;
	styledText(trackId: string): string | undefined;
	attach(element: SubtitleElement): void;
	dispose(): void;
}

/** Fetch bounded, version-bound sidecars before connecting Movi's source. */
export async function prepareExternalSubtitles(
	fileId: string,
	sourceVersion: string,
	timeline: MediaTimeline,
	signal: AbortSignal,
): Promise<ExternalSubtitles> {
	const tracks: HTMLTrackElement[] = [];
	const generated: {
		lang: string;
		label: string;
		cues: SubtitleCue[];
		text: string;
	}[] = [];
	const urls: string[] = [];
	let element: SubtitleElement | undefined;
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const url of urls) URL.revokeObjectURL(url);
		for (const track of generated) element?.removeSubtitleCues(track.lang);
		signal.removeEventListener("abort", dispose);
	};
	signal.addEventListener("abort", dispose, { once: true });
	if (signal.aborted) dispose();
	const result: ExternalSubtitles = {
		tracks,
		get hasAss() {
			return generated.length > 0;
		},
		styledText(trackId) {
			return generated.find((track) => track.lang === trackId)?.text;
		},
		attach(next) {
			if (disposed) return;
			element = next;
			for (const track of generated) {
				// A recovery replaces Movi's core; registering again restores this generation.
				next.appendSubtitleCues(track.cues, {
					lang: track.lang,
					label: track.label,
					select: false,
				});
			}
		},
		dispose,
	};
	try {
		if (disposed) return result;
		const discovered = await discoverSubtitles(fileId, { signal });
		if (disposed || discovered.sourceVersion !== sourceVersion) return result;
		await Promise.all(
			discovered.tracks
				.filter((track) => track.origin === "external" && track.format)
				.map(async (track) => {
					try {
						const response = await fetch(
							`/api/files/${encodeURIComponent(fileId)}/subtitles/${encodeURIComponent(track.id)}/content?${new URLSearchParams({ sourceVersion, subtitleVersion: track.sourceVersion })}`,
							{ credentials: "same-origin", signal },
						);
						if (!response.ok) throw new Error("Subtitle unavailable.");
						const contents = await response.text();
						if (disposed) return;
						const lang = `external:${track.id}`;
						const label = track.label ?? track.name;
						if (track.format === "ass" || track.format === "ssa") {
							if (
								!/^\s*\[Events\]/im.test(contents) ||
								!/^\s*Dialogue\s*:/im.test(contents)
							)
								throw new Error("No subtitle dialogue.");
							let cues: SubtitleCue[] = [];
							try {
								cues = assSubtitleCues(contents, timeline);
							} catch {
								console.warn(
									"[playback] Basic subtitle fallback could not be generated.",
									{ fileId, trackId: track.id },
								);
							}
							generated.push({ lang, label, cues, text: contents });
						} else if (track.format === "vtt" || track.format === "srt") {
							const url = URL.createObjectURL(
								new Blob([nativeSubtitleText(contents)], {
									type: "text/plain",
								}),
							);
							urls.push(url);
							const child = document.createElement("track");
							child.kind = "subtitles";
							child.src = url;
							child.srclang = lang;
							child.label = label;
							child.dataset.format = track.format;
							tracks.push(child);
						}
					} catch {
						if (!disposed)
							console.warn(
								"[playback] A sidecar subtitle could not be loaded.",
								{
									fileId,
									trackId: track.id,
								},
							);
					}
				}),
		);
	} catch {
		if (!disposed)
			console.warn("[playback] Sidecar subtitles could not be discovered.", {
				fileId,
			});
	}
	return result;
}
