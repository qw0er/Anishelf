import { DomainError } from "../../../../shared/errors.js";
import { fingerprint } from "../../../../shared/fingerprint.js";
import type {
	AssetInspection,
	CompatibilityEvidence,
	CompatibilityQuery,
	MediaAsset,
} from "../../../media/public.js";
import type { AssetCompatibility } from "../public.js";

export function inspectAsset(
	asset: MediaAsset,
	sourceAudio: number | null,
	canSelectAudio: boolean,
): AssetInspection {
	const position = asset.audioTracks.findIndex(
		(track) => track.sourceStreamIndex === sourceAudio,
	);
	const track = asset.audioTracks[position];
	const audio = track
		? {
				streamIndex: track.stream.index,
				sourceStreamIndex: track.sourceStreamIndex,
				position,
			}
		: null;
	const mime: Record<string, string> = {
		mp4: "video/mp4",
		quicktime: "video/quicktime",
		matroska: "video/x-matroska",
		webm: "video/webm",
	};
	const base = mime[asset.container ?? ""] ?? null;
	const video = asset.video;
	const sound = track?.stream ?? null;
	const contentType = (kind: "video" | "audio", codecs: (string | null)[]) =>
		base && codecs.length && codecs.every(Boolean)
			? `${base.replace(/^video\//, `${kind}/`)}; codecs="${codecs.join(", ")}"`
			: null;
	const query = (
		id: string,
		v: boolean,
		a: boolean,
		containerOnly = false,
	): CompatibilityQuery => ({
		id,
		type: "file",
		contentType: containerOnly
			? base
			: contentType(v ? "video" : "audio", [
					...(v && video ? [video.codecString] : []),
					...(a && sound ? [sound.codecString] : []),
				]),
		video:
			v && video
				? {
						contentType: contentType("video", [video.codecString]),
						width: video.width,
						height: video.height,
						frameRate: video.frameRate,
						bitrate: video.bitrate,
					}
				: null,
		audio:
			a && sound
				? {
						contentType: contentType("audio", [sound.codecString]),
						sampleRate: sound.sampleRate,
						channels: sound.channels,
						bitrate: sound.bitrate,
					}
				: null,
	});
	const queries = [
		query("container", false, false, true),
		query("combined", true, Boolean(sound)),
		query("video", true, false),
		...(sound ? [query("audio", false, true)] : []),
	];
	return {
		asset,
		audio,
		queries,
		descriptionId: fingerprint({
			version: "asset-playback:1",
			asset,
			sourceAudio,
			canSelectAudio,
			queries,
		}),
	};
}
export function assessAsset(
	inspection: AssetInspection,
	evidence: CompatibilityEvidence[],
	canSelectAudio: boolean,
): AssetCompatibility {
	const seen = new Set<string>();
	for (const entry of evidence) {
		if (
			!inspection.queries.some((query) => query.id === entry.id) ||
			seen.has(entry.id) ||
			(entry.status === "supported") !==
				(entry.reason === "browser-supported") ||
			(entry.status === "unsupported") !== (entry.reason === "browser-rejected")
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"Invalid asset compatibility evidence.",
			);
		seen.add(entry.id);
	}
	const decision = (id: string): AssetCompatibility["overall"] => {
		if (!inspection.queries.find((query) => query.id === id)?.contentType)
			return { status: "unknown", reason: "incomplete-description" };
		const report = evidence.find((entry) => entry.id === id);
		return report
			? { status: report.status, reason: report.reason }
			: { status: "unknown", reason: "missing-evidence" };
	};
	const { asset, audio } = inspection;
	const container = decision("container");
	const video = decision("video");
	const sound = audio
		? decision("audio")
		: asset.audioTracks.length
			? { status: "unsupported" as const, reason: "audio-track-missing" }
			: { status: "supported" as const, reason: "no-audio-stream" };
	let overall = decision("combined");
	if (container.status === "unsupported")
		overall = { status: "unsupported", reason: "container-rejected" };
	if (asset.inspection === "complete" && !asset.video)
		overall = { status: "unsupported", reason: "no-video-stream" };
	if (
		asset.audioTracks.length > 1 &&
		!canSelectAudio &&
		overall.status === "supported"
	)
		overall = { status: "unknown", reason: "native-track-selection-uncertain" };
	if (
		audio &&
		asset.audioTracks.length > 1 &&
		!canSelectAudio &&
		audio.streamIndex !== asset.defaultAudioStreamIndex
	)
		overall = {
			status: "unsupported",
			reason: "audio-track-selection-unavailable",
		};
	if (asset.video?.hdr && overall.status === "supported")
		overall = { status: "unknown", reason: "hdr-display-unverified" };
	if (asset.inspection === "unavailable")
		overall = { status: "unknown", reason: "inspection-unavailable" };
	return {
		overall,
		container,
		video,
		audio: sound,
		warnings: evidence.some((entry) => entry.smooth === false)
			? ["playback-may-not-be-smooth"]
			: [],
	};
}
