import type {
	MediaCapabilityKind,
	ServerMediaCapabilities,
} from "../../shared/media-capabilities.js";
import type { MediaProcessingPlan } from "../../shared/media-processing.js";
import type { DeepReadonly } from "../../shared/policy.js";
import { MediaToolError } from "./errors.js";
import type { MediaInfo } from "./model.js";

export interface ExecutionCapabilityRequirement {
	kind: MediaCapabilityKind | "tools";
	name: string;
	purpose: string;
	status: "supported" | "missing" | "unknown";
}
export interface ExecutionCapabilityCheck {
	status: "supported" | "missing" | "unknown";
	runtimeValidation: "unverified";
	requirements: ExecutionCapabilityRequirement[];
}

/** Checks an explicit execution configuration against cached build inventory. Never selects encoders. */
export function checkExecutionCapabilities(
	server: ServerMediaCapabilities,
	plan: DeepReadonly<MediaProcessingPlan>,
	info: MediaInfo,
	videoStreamIndex: number,
	audioStreamIndex: number | null,
): ExecutionCapabilityCheck {
	const requirements: ExecutionCapabilityRequirement[] = [];
	function require(
		kind: MediaCapabilityKind,
		name: string,
		purpose: string,
		accepts: (
			entry: ServerMediaCapabilities["inventory"][MediaCapabilityKind]["entries"][number],
		) => boolean,
	) {
		const inventory = server.inventory[kind];
		requirements.push({
			kind,
			name,
			purpose,
			status:
				inventory.status !== "ready"
					? "unknown"
					: inventory.entries.some(accepts)
						? "supported"
						: "missing",
		});
	}
	function named(kind: MediaCapabilityKind, name: string, purpose: string) {
		require(kind, name, purpose, (entry) => entry.name === name);
	}
	for (const name of ["ffmpeg", "ffprobe"] as const)
		requirements.push({
			kind: "tools",
			name,
			purpose: name === "ffmpeg" ? "execution" : "output-validation",
			status:
				server.tools[name].available === null
					? "unknown"
					: server.tools[name].available
						? "supported"
						: "missing",
		});
	require("demuxers", info.formatAliases.join(",") ||
		"unknown", "source-input", (entry) =>
		info.formatAliases.includes(entry.name));
	if (!info.formatAliases.length)
		requirements[requirements.length - 1] = {
			kind: "demuxers",
			name: "unknown",
			purpose: "source-input",
			status: "unknown",
		};
	named("muxers", plan.profile.container, "output-packaging");
	require("protocols", "file", "local-input-output", (entry) =>
		entry.name === "file" &&
		entry.flags.includes("I") &&
		entry.flags.includes("O"));
	require("protocols", "pipe", "progress-output", (entry) =>
		entry.name === "pipe" && entry.flags.includes("O"));
	for (const [kind, index, operation, encoding] of [
		["video", videoStreamIndex, plan.operation.video, plan.profile.video],
		["audio", audioStreamIndex, plan.operation.audio, plan.profile.audio],
	] as const) {
		if (index === null || operation !== "encode") continue;
		const stream = info.streams.find(
			(entry) => entry.index === index && entry.type === kind,
		);
		if (!stream?.codec)
			requirements.push({
				kind: "decoders",
				name: "unknown",
				purpose: `${kind}-input`,
				status: "unknown",
			});
		else
			require("decoders", stream.codec, `${kind}-input`, (entry) =>
				entry.codec === stream.codec && entry.mediaType === kind);
		require("encoders", encoding.encoder, `${kind}-output`, (entry) =>
			entry.name === encoding.encoder &&
			entry.codec === encoding.codec &&
			entry.mediaType === kind);
	}
	if (plan.operation.video === "encode") {
		require("pixelFormats", plan.profile.video.pixelFormat, "video-output", (
			entry,
		) =>
			entry.name === plan.profile.video.pixelFormat &&
			entry.flags.includes("O"));
		if (plan.profile.video.padToEven)
			named("filters", "pad", "even-video-dimensions");
		const video = info.streams.find(
			(stream) => stream.index === videoStreamIndex,
		);
		if (video?.pixelFormat !== plan.profile.video.pixelFormat)
			named("filters", "scale", "pixel-format-conversion");
	}
	return {
		status: requirements.some((requirement) => requirement.status === "missing")
			? "missing"
			: requirements.some((requirement) => requirement.status === "unknown")
				? "unknown"
				: "supported",
		runtimeValidation: "unverified",
		requirements,
	};
}

export class MediaExecutionCapabilityError extends MediaToolError {
	constructor(readonly check: ExecutionCapabilityCheck) {
		super(
			check.status === "missing" ? "CAPABILITY_MISSING" : "CAPABILITY_UNKNOWN",
			"Execution requirements are missing or unverified.",
		);
	}
}
