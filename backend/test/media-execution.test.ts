import { expect, test } from "vitest";
import { checkExecutionCapabilities } from "../src/platform/media/execution-capabilities.js";
import { parseMediaInfo } from "../src/platform/media/tools.js";
import { unknownMediaCapabilities } from "../src/shared/media-capabilities.js";
import type { MediaProcessingPlan } from "../src/shared/media-processing.js";

const info = parseMediaInfo(
	JSON.stringify({
		format: { format_name: "matroska,webm", duration: "1" },
		streams: [
			{ index: 0, codec_type: "video", codec_name: "vp9", pix_fmt: "yuv420p" },
			{ index: 1, codec_type: "audio", codec_name: "opus" },
		],
	}),
);
const plan: MediaProcessingPlan = {
	id: "caller-plan",
	container: "webm",
	outputFormat: "matroska",
	video: { action: "copy" },
	audio: { action: "copy" },
	filters: [],
};
function inventory() {
	const server = unknownMediaCapabilities();
	server.tools.ffmpeg.available = server.tools.ffprobe.available = true;
	for (const entry of Object.values(server.inventory)) entry.status = "ready";
	for (const [kind, name, flags] of [
		["demuxers", "matroska", ""],
		["muxers", "webm", ""],
		["protocols", "file", "IO"],
		["protocols", "pipe", "O"],
	] as const)
		server.inventory[kind].entries.push({
			name,
			flags,
			description: "",
			codec: null,
			mediaType: null,
		});
	return server;
}
test("copy checks packaging and protocols without encoding dependencies", () => {
	const check = checkExecutionCapabilities(inventory(), plan, info, 0, [1]);
	expect(check.status).toBe("supported");
	expect(
		check.requirements.some(
			(r) => r.kind === "encoders" || r.kind === "decoders",
		),
	).toBe(false);
	expect(check.runtimeValidation).toBe("unverified");
});
test("uses caller-selected encoder names and preserves missing versus unknown", () => {
	const server = inventory();
	const explicit: MediaProcessingPlan = {
		...plan,
		audio: { action: "encode", encoder: "libopus", codec: "opus" },
	};
	const check = checkExecutionCapabilities(server, explicit, info, 0, [1]);
	expect(check.status).toBe("missing");
	expect(
		check.requirements.filter((r) => r.kind === "encoders").map((r) => r.name),
	).toEqual(["libopus"]);
	server.inventory.encoders.status = server.inventory.decoders.status =
		"failed";
	expect(
		checkExecutionCapabilities(server, explicit, info, 0, [1]).status,
	).toBe("unknown");
	expect(checkExecutionCapabilities(server, explicit, info, 0, []).status).toBe(
		"supported",
	);
});
test("checks caller-declared pixel format and filters without assuming padding or scaling", () => {
	const server = inventory();
	const explicit: MediaProcessingPlan = {
		...plan,
		video: {
			action: "encode",
			encoder: "libvpx-vp9",
			codec: "vp9",
			pixelFormat: "yuv420p10le",
		},
		filters: ["zscale"],
	};
	server.inventory.decoders.entries.push({
		name: "vp9",
		description: "",
		codec: "vp9",
		mediaType: "video",
		flags: "V",
	});
	server.inventory.encoders.entries.push({
		name: "libvpx-vp9",
		description: "",
		codec: "vp9",
		mediaType: "video",
		flags: "V",
	});
	server.inventory.pixelFormats.entries.push({
		name: "yuv420p10le",
		description: "",
		codec: null,
		mediaType: null,
		flags: "IO",
	});
	expect(
		checkExecutionCapabilities(server, explicit, info, 0, [1]).status,
	).toBe("missing");
	server.inventory.filters.entries.push({
		name: "zscale",
		description: "",
		codec: null,
		mediaType: null,
		flags: "",
	});
	expect(
		checkExecutionCapabilities(server, explicit, info, 0, [1]).status,
	).toBe("supported");
});
test("protocol directions and unknown input aliases are checked independently", () => {
	const server = inventory();
	server.inventory.protocols.entries = server.inventory.protocols.entries.map(
		(entry) => ({ ...entry, flags: "I" }),
	);
	expect(checkExecutionCapabilities(server, plan, info, 0, [1]).status).toBe(
		"missing",
	);
	expect(
		checkExecutionCapabilities(
			inventory(),
			plan,
			{ ...info, formatAliases: [] },
			0,
			[1],
		).status,
	).toBe("unknown");
});
