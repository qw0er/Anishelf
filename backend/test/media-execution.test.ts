import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
	mediaProcessingPolicy,
	resolveMediaProcessingPlan,
} from "../src/modules/media-processing/public.js";
import { checkExecutionCapabilities } from "../src/platform/media/execution-capabilities.js";
import { runTool } from "../src/platform/media/process.js";
import { MediaTools, parseMediaInfo } from "../src/platform/media/tools.js";
import { unknownMediaCapabilities } from "../src/shared/media-capabilities.js";
import type { MediaProcessEvent } from "../src/shared/media-execution.js";

const tools = await MediaTools.create();
const available =
	tools.status.ffmpeg.available && tools.status.ffprobe.available;
let directory: string;
let input: string;
beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "anishelf-execution-"));
	input = join(directory, "source.mkv");
	if (tools.status.ffmpeg.available && available)
		await runTool(tools.status.ffmpeg.path, [
			"-nostdin",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=64x64:rate=10:duration=1",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:sample_rate=48000:duration=1",
			"-c:v",
			"libx264",
			"-threads",
			"1",
			"-c:a",
			"aac",
			"-shortest",
			input,
		]);
});
afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

const info = parseMediaInfo(
	JSON.stringify({
		format: { format_name: "matroska,webm", duration: "1" },
		streams: [
			{ index: 0, codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p" },
			{ index: 1, codec_type: "audio", codec_name: "aac" },
		],
	}),
);
function inventory() {
	const server = unknownMediaCapabilities();
	server.tools.ffmpeg.available = server.tools.ffprobe.available = true;
	for (const entry of Object.values(server.inventory)) entry.status = "ready";
	function add(
		kind: "demuxers" | "muxers" | "protocols",
		name: string,
		flags = "",
	) {
		server.inventory[kind].entries.push({
			name,
			flags,
			description: "",
			codec: null,
			mediaType: null,
		});
	}
	add("demuxers", "matroska");
	add("muxers", "mp4");
	add("protocols", "file", "IO");
	add("protocols", "pipe", "O");
	return server;
}
test("copy checks input/output requirements without requiring encoders or decoders", () => {
	const check = checkExecutionCapabilities(
		inventory(),
		resolveMediaProcessingPlan(mediaProcessingPolicy, "remux"),
		info,
		0,
		1,
	);
	expect(check.status).toBe("supported");
	expect(
		check.requirements.some(
			(r) => r.kind === "encoders" || r.kind === "decoders",
		),
	).toBe(false);
	expect(check.runtimeValidation).toBe("unverified");
});
test("encoding checks selected streams and preserves missing versus unknown", () => {
	const server = inventory();
	const plan = resolveMediaProcessingPlan(
		mediaProcessingPolicy,
		"transcode-audio",
	);
	const check = checkExecutionCapabilities(server, plan, info, 0, 1);
	expect(check.status).toBe("missing");
	expect(
		check.requirements.filter((r) => r.kind === "encoders").map((r) => r.name),
	).toEqual(["aac"]);
	server.inventory.encoders.status = server.inventory.decoders.status =
		"failed";
	expect(checkExecutionCapabilities(server, plan, info, 0, 1).status).toBe(
		"unknown",
	);
	expect(checkExecutionCapabilities(server, plan, info, 0, null).status).toBe(
		"supported",
	);
	const protocol = server.inventory.protocols.entries[0];
	if (!protocol) throw new Error("Missing fixture protocol");
	protocol.flags = "I";
	expect(checkExecutionCapabilities(server, plan, info, 0, null).status).toBe(
		"missing",
	);
});
test
	.runIf(available)
	.each(["remux", "transcode-audio", "transcode-video", "transcode"] as const)(
	"executes and validates real %s with streamed progress",
	async (mode) => {
		const output = join(directory, `${mode}.mp4`);
		const events: MediaProcessEvent[] = [];
		const source = await tools.probe(input);
		const result = await tools.processMedia(
			input,
			output,
			{
				plan: resolveMediaProcessingPlan(mediaProcessingPolicy, mode),
				videoStreamIndex: 0,
				audioStreamIndex: 1,
				maximumBytes: 1024 * 1024,
				timeoutMs: 10000,
				onEvent: (event) => events.push(event),
			},
			source,
		);
		expect(result.container).toBe("mp4");
		expect(result.streams.map((s) => s.codec)).toEqual(["h264", "aac"]);
		expect(result.duration).toBeGreaterThan(0.9);
		expect(events.some((e) => e.type === "progress")).toBe(true);
		expect(events.at(-1)).toMatchObject({ type: "closed", reason: null });
	},
);
test.runIf(available)(
	"rejects missing and unknown capabilities before creating an output",
	async () => {
		const source = await tools.probe(input);
		const server = await tools.capabilities();
		const original = structuredClone(server);
		const spy = vi.spyOn(tools, "capabilities");
		try {
			for (const status of ["ready", "failed"] as const) {
				server.inventory.muxers = { status, entries: [], error: null };
				spy.mockResolvedValue(server);
				const output = join(directory, `${status}.mp4`);
				await expect(
					tools.processMedia(
						input,
						output,
						{
							plan: resolveMediaProcessingPlan(mediaProcessingPolicy, "remux"),
							videoStreamIndex: 0,
							audioStreamIndex: 1,
							maximumBytes: 1024 * 1024,
							timeoutMs: 10000,
						},
						source,
					),
				).rejects.toMatchObject({
					code:
						status === "ready" ? "CAPABILITY_MISSING" : "CAPABILITY_UNKNOWN",
				});
				await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
			}
		} finally {
			spy.mockResolvedValue(original);
			spy.mockRestore();
		}
	},
);
