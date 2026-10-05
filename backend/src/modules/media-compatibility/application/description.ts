import type {
	CompatibilityQuery,
	CompatibilityStream,
} from "../../../contracts/http.js";
import type { MediaInfo, MediaStream } from "../../../platform/media/index.js";
import { DomainError } from "../../../shared/errors.js";
import type { OriginalMediaDescription } from "../domain/model.js";

const mime: Record<string, string> = {
	mp4: "video/mp4",
	quicktime: "video/quicktime",
	matroska: "video/x-matroska",
	webm: "video/webm",
};
function describe(stream: MediaStream | undefined): CompatibilityStream | null {
	if (!stream) return null;
	return {
		index: stream.index,
		kind: stream.type === "video" ? "video" : "audio",
		codec: stream.codec,
		codecString: stream.codecString ?? null,
		profile: stream.profile,
		pixelFormat: stream.pixelFormat,
		bitDepth: stream.bitDepth,
		hdr: stream.hdr.pq || stream.hdr.hlg || stream.hdr.sideDataTypes.length > 0,
		width: stream.width,
		height: stream.height,
		frameRate: stream.framesPerSecond,
		bitrate: stream.bitRate,
		sampleRate: stream.sampleRate,
		channels: stream.channels,
		language: stream.tags.language?.slice(0, 256) ?? null,
		label: stream.tags.title?.slice(0, 256) ?? null,
		default: stream.default,
	};
}
export function describeOriginalMedia(
	fileId: string,
	sourceVersion: string,
	info: MediaInfo,
	selection?: number[],
): OriginalMediaDescription {
	const videos = info.streams.filter(
		(s) => s.type === "video" && !s.attachedPicture,
	);
	const audios = info.streams.filter((s) => s.type === "audio");
	const video = describe(videos.find((s) => s.default) ?? videos[0]);
	const audio = describe(audios.find((s) => s.default) ?? audios[0]);
	const audioTracks = audios.map(
		(stream) => describe(stream) as CompatibilityStream,
	);
	if (
		audioTracks.length > 128 ||
		(selection &&
			(new Set(selection).size !== selection.length ||
				selection.some(
					(index) => !audioTracks.some((track) => track.index === index),
				)))
	)
		throw new DomainError(
			"INVALID_REQUEST",
			"Invalid audio stream selection or too many audio tracks.",
		);
	const selectedAudioTracks = selection
		? selection.map(
				(index) =>
					audioTracks.find(
						(track) => track.index === index,
					) as CompatibilityStream,
			)
		: audioTracks;
	const queries: CompatibilityQuery[] = [];
	const add = (
		id: string,
		type: CompatibilityQuery["type"],
		base: string | null,
		v: CompatibilityStream | null,
		a: CompatibilityStream | null,
		containerOnly = false,
	) => {
		const streams = [v, a].filter((s): s is CompatibilityStream => s !== null);
		const codecs = streams.map((s) => s.codecString);
		const contentType =
			base && (containerOnly || (streams.length > 0 && codecs.every(Boolean)))
				? containerOnly
					? base
					: `${base}; codecs="${codecs.join(", ")}"`
				: null;
		queries.push({ id, type, contentType, video: v, audio: a });
	};
	const base = mime[info.container ?? ""] ?? null;
	add("original-container", "file", base, null, null, true);
	add("original", "file", base, video, audio);
	add("original-video", "file", base, video, null);
	if (audio)
		add(
			"original-audio",
			"file",
			base?.replace("video/", "audio/") ?? null,
			null,
			audio,
		);
	for (const track of audioTracks) {
		if (track.index === audio?.index) continue;
		add(
			`original-audio-${track.index}`,
			"file",
			base?.replace("video/", "audio/") ?? null,
			null,
			track,
		);
		add(`original-${track.index}`, "file", base, video, track);
	}
	return {
		fileId,
		sourceVersion,
		rulesVersion: "3",
		container: info.container,
		video,
		audio,
		multipleTracks: videos.length > 1 || audios.length > 1,
		audioTracks,
		selectedAudioTracks,
		queries,
	};
}
