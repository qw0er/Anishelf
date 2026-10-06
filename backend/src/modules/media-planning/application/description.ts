import type { MediaInfo } from "../../../platform/media/index.js";
import { DomainError } from "../../../shared/errors.js";
import type {
	CompatibilityAudioStream,
	CompatibilityQuery,
	CompatibilityStream,
	CompatibilityVideoStream,
} from "../../../shared/media-negotiation.js";
import type { OriginalMediaDescription } from "../domain/model.js";
import { browserQuery } from "../domain/output-spec.js";
import { describeAudio, describeVideo } from "../domain/streams.js";

const mime: Record<string, string> = {
	mp4: "video/mp4",
	quicktime: "video/quicktime",
	matroska: "video/x-matroska",
	webm: "video/webm",
};
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
	const chosenVideo = videos.find((s) => s.default) ?? videos[0];
	const video = chosenVideo ? describeVideo(chosenVideo) : null;
	const chosenAudio = audios.find((s) => s.default) ?? audios[0];
	const audio = chosenAudio ? describeAudio(chosenAudio) : null;
	const audioTracks = audios.map(describeAudio);
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
	const selectedAudioStreamIndices = selection
		? [...selection]
		: audioTracks.map((track) => track.index);
	const queries: CompatibilityQuery[] = [];
	const add = (
		id: string,
		type: CompatibilityQuery["type"],
		base: string | null,
		v: CompatibilityVideoStream | null,
		a: CompatibilityAudioStream | null,
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
		queries.push(browserQuery(id, type, contentType, base, v, a));
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
		rulesVersion: "4",
		container: info.container,
		video,
		defaultAudioStreamIndex: audio?.index ?? null,
		multipleTracks: videos.length > 1 || audios.length > 1,
		audioTracks,
		selectedAudioStreamIndices,
		queries,
	};
}
