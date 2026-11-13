import type {
	AudioAcceptance,
	VideoAcceptance,
} from "@anishelf/contracts/auto-preparation";
import type { DeepReadonly } from "../../shared/policy.js";
import type { MediaStream } from "./model.js";

type Acceptance = "accepted" | "rejected" | "unknown";
export function normalizeMediaProfile(value: string): string {
	return value
		.toLowerCase()
		.replace(/^profile\s*/, "")
		.trim()
		.replace(/[ _]+/g, "-")
		.replace(/^aac-/, "")
		.replace(/^high(10|422|444)$/, "high-$1")
		.replace(/^main10$/, "main-10");
}
function dynamicRange(stream: DeepReadonly<MediaStream>): string | null {
	if (stream.hdr.hlg) return "hlg";
	if (stream.hdr.pq) return "hdr10";
	if (stream.hdr.sideDataTypes.length) return null;
	if (
		[
			"bt709",
			"smpte170m",
			"smpte240m",
			"gamma22",
			"gamma28",
			"iec61966-2-1",
			"bt470m",
			"bt470bg",
		].includes(stream.colorTransfer ?? "")
	)
		return "sdr";
	// Untagged 8-bit conventional video is treated as SDR; untagged high-bit-depth is uncertain.
	return stream.bitDepth === 8 || stream.pixelFormat === "yuv420p"
		? "sdr"
		: null;
}
export function codecLevel(
	codec: string | null,
	level: number | null,
): number | null {
	if (level === null || level < 0) return null;
	if (codec === "h264" || codec === "vp9") return level / 10;
	if (codec === "hevc") return level / 30;
	if (codec === "av1") return 2 + Math.floor(level / 4) + (level % 4) / 10;
	return null;
}
function _acceptsStream(
	stream: DeepReadonly<MediaStream>,
	candidates: DeepReadonly<(VideoAcceptance | AudioAcceptance)[]> | undefined,
): Acceptance {
	if (!candidates?.length) return "accepted";
	const results = candidates.map((candidate) => {
		const checks: Acceptance[] = [];
		const list = (
			allowed: readonly (string | number)[] | undefined,
			value: string | number | null,
		) => {
			if (allowed?.length)
				checks.push(
					value === null
						? "unknown"
						: allowed.includes(value)
							? "accepted"
							: "rejected",
				);
		};
		const maximum = (
			limit: number | null | undefined,
			value: number | null,
		) => {
			if (limit != null)
				checks.push(
					value === null ? "unknown" : value <= limit ? "accepted" : "rejected",
				);
		};
		list(candidate.codecs, stream.codec);
		list(
			candidate.profiles?.map(normalizeMediaProfile),
			stream.profile === null ? null : normalizeMediaProfile(stream.profile),
		);
		maximum(
			candidate.maxBitrateKbps,
			stream.bitRate === null ? null : stream.bitRate / 1000,
		);
		if ("pixelFormats" in candidate)
			list(candidate.pixelFormats, stream.pixelFormat);
		if ("dynamicRanges" in candidate)
			list(candidate.dynamicRanges, dynamicRange(stream));
		if ("maxLevel" in candidate && candidate.maxLevel != null)
			maximum(
				Number(candidate.maxLevel),
				codecLevel(stream.codec, stream.level),
			);
		if ("maxWidth" in candidate) maximum(candidate.maxWidth, stream.width);
		if ("maxHeight" in candidate) maximum(candidate.maxHeight, stream.height);
		if ("maxFrameRate" in candidate)
			maximum(candidate.maxFrameRate, stream.framesPerSecond);
		if ("maxChannels" in candidate)
			maximum(candidate.maxChannels, stream.channels);
		if ("sampleRates" in candidate)
			list(candidate.sampleRates, stream.sampleRate);
		return checks.includes("rejected")
			? "rejected"
			: checks.includes("unknown")
				? "unknown"
				: "accepted";
	});
	return results.includes("accepted")
		? "accepted"
		: results.includes("unknown")
			? "unknown"
			: "rejected";
}
/** Conservative muxing policy, not a browser compatibility verdict. */
export function canMux(
	container: string,
	codec: string | null,
	kind: "video" | "audio",
): boolean {
	if (!codec) return false;
	if (container === "matroska") return true;
	const codecs =
		container === "webm"
			? kind === "video"
				? ["vp8", "vp9", "av1"]
				: ["opus", "vorbis"]
			: kind === "video"
				? ["h264", "hevc", "av1", "vp9", "mpeg4"]
				: ["aac", "mp3", "ac3", "eac3", "alac", "opus", "flac"];
	return codecs.includes(codec);
}
