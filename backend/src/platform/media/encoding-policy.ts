import type { DeepReadonly } from "../../shared/policy.js";
import type {
	AudioEncoding,
	EncodingOptions,
	VideoEncoding,
} from "./encoding.js";

export type OptionScope = "global" | "input" | "video" | "audio" | "muxer";
const reserved = new Set([
	"i",
	"map",
	"map_metadata",
	"map_chapters",
	"map_channel",
	"c",
	"codec",
	"vcodec",
	"acodec",
	"f",
	"progress",
	"stats",
	"nostats",
	"stats_period",
	"stdin",
	"nostdin",
	"y",
	"n",
	"fs",
	"t",
	"to",
	"ss",
	"sseof",
	"itsoffset",
	"itsscale",
	"copyts",
	"start_at_zero",
	"shortest",
	"stream_loop",
	"frames",
	"vframes",
	"aframes",
	"vn",
	"an",
	"sn",
	"dn",
	"vf",
	"af",
	"filter",
	"filter_complex",
	"filter_script",
	"filter_complex_script",
	"pix_fmt",
	"ac",
	"ar",
	"s",
	"r",
	"protocol_whitelist",
	"protocol_blacklist",
	"report",
	"pass",
	"passlogfile",
	"vstats",
	"vstats_file",
	"attach",
	"dump_attachment",
	"target",
	"disposition",
	"loglevel",
	"v",
	"h",
	"help",
	"version",
]);
const temporal = new Set([
	"trim",
	"atrim",
	"setpts",
	"asetpts",
	"settb",
	"asettb",
	"select",
	"aselect",
	"reverse",
	"areverse",
	"loop",
	"aloop",
	"tpad",
	"apad",
	"atempo",
	"asetrate",
	"rubberband",
	"minterpolate",
	"mpdecimate",
	"decimate",
	"framestep",
	"shuffleframes",
	"setts",
	"sendcmd",
	"asendcmd",
	"movie",
	"amovie",
	"zmq",
	"azmq",
	"concat",
	"split",
	"asplit",
]);

/** A list entry is one filter, not an embedded graph. Respect FFmpeg quoting/escaping. */
export function filterName(expression: string): string {
	if (expression.includes("\0")) throw new Error("Invalid filter expression.");
	const match = expression.match(/^([a-zA-Z][a-zA-Z0-9_]*)(?:=.*)?$/s);
	if (!match) throw new Error("Expected one named filter per list entry.");
	let quoted = false;
	for (let i = expression.indexOf("=") + 1; i < expression.length; i++) {
		const c = expression[i];
		if (c === "\\") {
			i++;
			continue;
		}
		if (c === "'") quoted = !quoted;
		if (!quoted && c !== undefined && ",;[]".includes(c))
			throw new Error(
				"Filter graphs and additional stream labels are unsupported.",
			);
	}
	if (quoted) throw new Error("Unterminated filter quote.");
	const name = match[1] as string;
	if (temporal.has(name))
		throw new Error(
			"Timeline editing and additional filter inputs are unsupported.",
		);
	return name;
}
export function validateEncodingOptions(
	options: DeepReadonly<EncodingOptions> | undefined,
	scope: OptionScope,
): void {
	for (const [name, value] of Object.entries(options ?? {})) {
		if (
			!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) ||
			reserved.has(name) ||
			name.startsWith("stats_") ||
			name.startsWith("map_") ||
			(name.startsWith("filter_") &&
				name !== "filter_threads" &&
				name !== "filter_buffered_frames")
		)
			throw new Error(`Reserved or invalid ${scope} option: ${name}.`);
		if (
			(value !== null &&
				typeof value !== "string" &&
				typeof value !== "number") ||
			(typeof value === "number" && !Number.isFinite(value)) ||
			(typeof value === "string" && value.includes("\0"))
		)
			throw new Error(`Invalid value for ${scope}.${name}.`);
	}
}
export function validEncodingOptions(
	video: DeepReadonly<VideoEncoding>,
	audio: DeepReadonly<AudioEncoding>,
): boolean {
	try {
		for (const [kind, stream] of [
			["video", video],
			["audio", audio],
		] as const) {
			validateEncodingOptions(stream.options, kind);
			for (const filter of stream.filters ?? []) filterName(filter);
			if (
				stream.encoder === "copy" &&
				Object.entries(stream).some(
					([k, v]) =>
						k !== "encoder" &&
						k !== "codec" &&
						v !== undefined &&
						(Array.isArray(v)
							? v.length > 0
							: typeof v === "object" && v !== null
								? Object.keys(v).length > 0
								: true),
				)
			)
				return false;
		}
		return true;
	} catch {
		return false;
	}
}

/** Adapt only persisted v1 execution snapshots, never administrator-authored v2 files. */
export function legacyVideo(value: Record<string, unknown>): VideoEncoding {
	const {
		crf,
		preset,
		cpuUsed,
		bitrateKbps,
		maxBitrateKbps,
		profile,
		level,
		...rest
	} = value;
	const options: EncodingOptions = {
		...(rest.options as EncodingOptions | undefined),
	};
	for (const [k, v] of Object.entries({
		crf,
		preset,
		"cpu-used": cpuUsed,
		b:
			bitrateKbps === undefined
				? cpuUsed === undefined
					? undefined
					: 0
				: `${bitrateKbps}k`,
		maxrate: maxBitrateKbps === undefined ? undefined : `${maxBitrateKbps}k`,
		bufsize:
			maxBitrateKbps === undefined
				? undefined
				: `${Number(maxBitrateKbps) * 2}k`,
		profile,
		level,
	}))
		if (v !== undefined) options[k] = v as string | number;
	return { ...rest, options } as unknown as VideoEncoding;
}
export function legacyAudio(value: Record<string, unknown>): AudioEncoding {
	const {
		channels,
		channelCount,
		bitrateKbps,
		compressionLevel,
		profile,
		...rest
	} = value;
	const options: EncodingOptions = {
		...(rest.options as EncodingOptions | undefined),
	};
	if (bitrateKbps !== undefined) options.b = `${bitrateKbps}k`;
	if (compressionLevel !== undefined)
		options.compression_level = Number(compressionLevel);
	if (profile !== undefined)
		options.profile = profile === "lc" ? "aac_low" : String(profile);
	return {
		...rest,
		...(typeof channels === "number"
			? { channels }
			: channelCount !== undefined
				? { channels: Number(channelCount) }
				: channels === "stereo"
					? { channels: 2 }
					: {}),
		options,
	} as unknown as AudioEncoding;
}
