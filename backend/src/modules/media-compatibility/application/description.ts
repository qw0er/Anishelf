import type {
	CompatibilityQuery,
	CompatibilityStream,
} from "../../../contracts/http.js";
import type { MediaInfo, MediaStream } from "../../../platform/media/index.js";
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
	};
}
export function describeOriginalMedia(
	fileId: string,
	sourceVersion: string,
	info: MediaInfo,
): OriginalMediaDescription {
	const videos = info.streams.filter(
		(s) => s.type === "video" && !s.attachedPicture,
	);
	const audios = info.streams.filter((s) => s.type === "audio");
	const video = describe(videos.find((s) => s.default) ?? videos[0]);
	const audio = describe(audios.find((s) => s.default) ?? audios[0]);
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
	return {
		fileId,
		sourceVersion,
		rulesVersion: "3",
		container: info.container,
		video,
		audio,
		multipleTracks: videos.length > 1 || audios.length > 1,
		queries,
	};
}
