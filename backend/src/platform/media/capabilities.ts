import type { Logger } from "pino";
import {
	type MediaCapabilityEntry,
	type MediaCapabilityKind,
	mediaCapabilityKinds,
	type ServerMediaCapabilities,
	unknownMediaCapabilities,
} from "../../shared/media-capabilities.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type { ToolStatus } from "./model.js";
import type { MediaToolPolicy } from "./policy.js";
import { runTool } from "./process.js";

const commands: Record<MediaCapabilityKind, string> = {
	codecs: "-codecs",
	encoders: "-encoders",
	decoders: "-decoders",
	muxers: "-muxers",
	demuxers: "-demuxers",
	filters: "-filters",
	bitstreamFilters: "-bsfs",
	protocols: "-protocols",
	devices: "-devices",
	pixelFormats: "-pix_fmts",
	sampleFormats: "-sample_fmts",
	hardwareAccelerations: "-hwaccels",
};
const mediaTypes: Record<string, MediaCapabilityEntry["mediaType"]> = {
	V: "video",
	A: "audio",
	S: "subtitle",
	D: "data",
	T: "attachment",
};
const headers: Record<MediaCapabilityKind, RegExp> = {
	codecs: /^Codecs:/m,
	encoders: /^Encoders:/m,
	decoders: /^Decoders:/m,
	muxers: /^(?:Formats|Muxers):/m,
	demuxers: /^(?:Formats|Demuxers):/m,
	filters: /^Filters:/m,
	devices: /^Devices:/m,
	pixelFormats: /^Pixel formats:/m,
	sampleFormats: /^name\s+depth\s*$/m,
	bitstreamFilters: /^Bitstream filters:/m,
	protocols: /^Supported file protocols:/m,
	hardwareAccelerations: /^Hardware acceleration methods:/m,
};

/** Parse FFmpeg's advertised build components, never infer hardware runtime support. */
export function parseMediaCapabilities(
	kind: MediaCapabilityKind,
	output: string,
): MediaCapabilityEntry[] {
	if (!headers[kind].test(output))
		throw new Error("Unexpected capability header.");
	const entries = new Map<string, MediaCapabilityEntry>();
	function add(
		name: string,
		description = "",
		flags = "",
		codec: string | null = null,
		mediaType: MediaCapabilityEntry["mediaType"] = null,
	) {
		entries.set(name, { name, description, flags, codec, mediaType });
	}
	const lines = output.split(/\r?\n/);
	if (kind === "protocols") {
		let direction = "";
		for (const line of lines.slice(
			lines.findIndex((line) => headers[kind].test(line)) + 1,
		)) {
			const value = line.trim();
			if (!value) continue;
			if (value === "Input:" || value === "Output:") {
				direction = value === "Input:" ? "I" : "O";
				continue;
			}
			if (!direction || !/^[\w-]+$/.test(value))
				throw new Error("Invalid protocol inventory.");
			add(value, "", `${entries.get(value)?.flags ?? ""}${direction}`);
		}
		if (direction !== "O") throw new Error("Incomplete protocol inventory.");
	} else if (
		kind === "bitstreamFilters" ||
		kind === "hardwareAccelerations" ||
		kind === "sampleFormats"
	) {
		for (const line of lines.slice(
			lines.findIndex((line) => headers[kind].test(line)) + 1,
		)) {
			if (!line.trim()) continue;
			const match =
				kind === "sampleFormats"
					? line.match(/^\s*([\w-]+)\s+(\d+)\s*$/)
					: line.match(/^\s*([\w-]+)\s*$/);
			if (!match) throw new Error("Invalid capability entry.");
			add(match[1] as string, match[2] ?? "");
		}
	} else {
		// Filters in FFmpeg 5/7 have no separator; device tables may use "--".
		const separator = lines.findIndex((line) =>
			(kind === "devices" ? /^\s*-{2,}\s*$/ : /^\s*-{3,}\s*$/).test(line),
		);
		if (separator === -1 && kind !== "filters")
			throw new Error("Missing capability table.");
		const start =
			separator === -1
				? lines.findIndex((line) => headers[kind].test(line))
				: separator;
		for (const line of lines.slice(start + 1)) {
			if (!line.trim()) continue;
			if (
				kind === "filters" &&
				entries.size === 0 &&
				/^\s*[TSC.AVN|]+\s+=\s+.+$/.test(line)
			)
				continue;
			const pattern =
				kind === "codecs"
					? /^\s*([D.][E.][VASDT.][I.][L.][S.])\s+(\S+)\s+(.*)$/
					: kind === "encoders" || kind === "decoders"
						? /^\s*([VAS][FSXBD.]{5})\s+(\S+)\s+(.*)$/
						: kind === "filters"
							? /^\s*([TSC.]{2,3})\s+(\S+)\s+([AVN|]+->[AVN|]+)\s+(.*)$/
							: kind === "pixelFormats"
								? /^\s*([I.][O.][H.][P.][B.])\s+(\S+)\s+(\d+\s+\d+(?:\s+[\d-]+)?)\s*$/
								: /^\s*([DEd. ]{1,3})\s+(\S+)(?:\s+(.*))?$/;
			const match = line.match(pattern);
			if (!match) throw new Error("Invalid capability table row.");
			const flags = (match[1] as string).trim();
			const names = (match[2] as string).split(",");
			const description =
				kind === "filters"
					? `${match[3]} ${match[4]}`
					: (match[3] ?? "").trim();
			for (const name of names) {
				const mediaType =
					mediaTypes[flags[kind === "codecs" ? 2 : 0] ?? ""] ?? null;
				const codec =
					kind === "codecs"
						? name
						: kind === "encoders" || kind === "decoders"
							? (description.match(/\(codec ([\w-]+)\)/)?.[1] ?? name)
							: null;
				add(
					name,
					description,
					flags,
					codec,
					kind === "codecs" || kind === "encoders" || kind === "decoders"
						? mediaType
						: null,
				);
			}
		}
	}
	return [...entries.values()].sort((a, b) =>
		a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
	);
}

export async function detectMediaCapabilities(
	tools: Readonly<{ ffmpeg: ToolStatus; ffprobe: ToolStatus }>,
	policy: DeepReadonly<MediaToolPolicy>,
	logger?: Logger,
): Promise<ServerMediaCapabilities> {
	const result = unknownMediaCapabilities();
	result.detectedAtMs = Date.now();
	for (const tool of ["ffmpeg", "ffprobe"] as const) {
		const status = tools[tool];
		result.tools[tool] = {
			available: status.available,
			version: status.available ? status.version : null,
		};
	}
	const ffmpeg = tools.ffmpeg;
	if (!ffmpeg.available) {
		result.status = "unavailable";
		for (const kind of mediaCapabilityKinds)
			result.inventory[kind] = {
				status: "unavailable",
				entries: [],
				error:
					"FFmpeg is unavailable. Check the executable configuration and restart.",
			};
		return result;
	}
	const executable = ffmpeg.path;
	// A bounded worker pool avoids spawning every enumeration process at once.
	const queue = [...mediaCapabilityKinds];
	async function worker() {
		for (let kind = queue.shift(); kind; kind = queue.shift()) {
			try {
				const output = await runTool(
					executable,
					["-hide_banner", commands[kind]],
					{
						timeoutMs: policy.detectionTimeoutMs,
						maxBytes: policy.capabilityMaximumBytes,
					},
					policy,
					logger,
				);
				result.inventory[kind] = {
					status: "ready",
					entries: parseMediaCapabilities(kind, output),
					error: null,
				};
			} catch {
				logger?.warn(
					{ event: "media.capability_detection_failed", kind },
					"Could not enumerate FFmpeg capabilities.",
				);
				result.inventory[kind] = {
					status: "failed",
					entries: [],
					error: `Could not enumerate FFmpeg ${kind}. Check server diagnostics and restart to retry.`,
				};
			}
		}
	}
	await Promise.all(
		Array.from(
			{ length: Math.min(policy.capabilityConcurrency, queue.length) },
			() => worker(),
		),
	);
	const ready = mediaCapabilityKinds.filter(
		(kind) => result.inventory[kind].status === "ready",
	).length;
	result.status =
		ready === mediaCapabilityKinds.length
			? "ready"
			: ready > 0
				? "partial"
				: "failed";
	return result;
}
