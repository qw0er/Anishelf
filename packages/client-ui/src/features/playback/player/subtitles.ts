import type { MediaTimeline } from "@anishelf/contracts/media";
import type { ExternalSubtitleTrack } from "libmedia-react-player";
import { getClientRuntime } from "../../../shared/api/connection.js";
import { discoverSubtitles } from "../../media/public.js";
import { playbackPolicy } from "./policy.js";

/** Load a stable collection for one asset before starting the player. */
export async function prepareExternalSubtitles(
	fileId: string,
	sourceVersion: string,
	timeline: MediaTimeline,
	lifetime: AbortSignal,
): Promise<readonly ExternalSubtitleTrack[]> {
	const signal = AbortSignal.any([
		lifetime,
		AbortSignal.timeout(playbackPolicy.requestTimeoutMs),
	]);
	const { connection } = getClientRuntime();
	try {
		const discovered = await discoverSubtitles(fileId, { signal });
		if (discovered.sourceVersion !== sourceVersion) return [];
		const tracks = await Promise.all(
			discovered.tracks.map(
				async (track): Promise<ExternalSubtitleTrack | null> => {
					const format = track.format;
					if (track.origin !== "external" || !format) return null;
					try {
						const query = new URLSearchParams({
							sourceVersion,
							subtitleVersion: track.sourceVersion,
						});
						const response = await connection.fetchResource(
							`/api/files/${encodeURIComponent(fileId)}/subtitles/${encodeURIComponent(track.id)}/content?${query}`,
							{ signal },
						);
						if (!response.ok) throw new Error("Subtitle unavailable.");
						const content = await response.blob();
						signal.throwIfAborted();
						const options = {
							content,
							label: track.label ?? track.name,
							...(track.language ? { language: track.language } : {}),
							offsetMs: timeline.mediaOriginMs - timeline.sourceOriginMs,
						};
						return format === "ass" || format === "ssa"
							? { ...options, format, renderer: "styled" }
							: { ...options, format };
					} catch {
						if (!lifetime.aborted)
							console.warn("[playback] Could not read a subtitle sidecar.", {
								fileId,
								trackId: track.id,
								timeout: signal.aborted,
							});
						return null;
					}
				},
			),
		);
		return tracks.filter((track) => track !== null);
	} catch {
		if (!lifetime.aborted)
			console.warn("[playback] Could not discover subtitle sidecars.", {
				fileId,
				timeout: signal.aborted,
			});
		return [];
	}
}
