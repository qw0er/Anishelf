import { afterEach, expect, test, vi } from "vitest";
import * as capabilities from "../../../src/platform/media/capabilities.js";
import { unknownMediaCapabilities } from "../../../src/platform/media/capability-model.js";
import {
	inspectEncodingProfiles,
	parseOptionHelp,
} from "../../../src/platform/media/option-catalog.js";
import * as processTools from "../../../src/platform/media/process.js";
import { MediaTools } from "../../../src/platform/media/tools.js";

afterEach(() => vi.restoreAllMocks());

test("selected encoder metadata and common help retain scopes across FFmpeg formats", () => {
	const help = parseOptionHelp(
		"Global options:\n-filter_threads threads\nAVCodecContext AVOptions:\n  -b <int64> E..VA...... bitrate\nlibunselected AVOptions:\n  -exclusive <int> E..V....... private\n",
	);
	expect([...help.options.keys()]).toEqual(["filter_threads", "b"]);
	expect(help.options.get("filter_threads")?.scopes).toEqual(["global"]);
	const encoder = parseOptionHelp(
		"Encoder custom [Custom]:\n Supported pixel formats: yuv420p nv12\ncustom AVOptions:\n -quality <int> E..V....... Quality\n",
		true,
	);
	expect(encoder.available).toBe(true);
	expect(encoder.pixelFormats).toEqual(["yuv420p", "nv12"]);
	expect(encoder.options.has("quality")).toBe(true);
});

test("runtime inventory infers codec while private/unknown values remain unverified", async () => {
	const server = unknownMediaCapabilities();
	server.inventory.encoders = {
		status: "ready",
		error: null,
		entries: [
			{
				name: "custom_encoder",
				codec: "h264",
				mediaType: "video",
				description: "Custom",
				flags: "V.....",
			},
		],
	};
	const result = await inspectEncodingProfiles(
		[
			{
				id: "custom:test",
				container: "mp4",
				video: {
					encoder: "custom_encoder",
					codec: "",
					options: { quality: 10, "custom-params": "nested=1", future: 1 },
				},
				audio: { encoder: "copy", codec: "" },
			},
		],
		server,
		async () =>
			parseOptionHelp(
				"Encoder custom_encoder [Custom]:\n -quality <int> E..V....... Quality\n -custom-params <string> E..V....... Private\n",
				true,
			),
	);
	expect(result.profiles[0]?.video.codec).toBe("h264");
	expect(result.validation["custom:test"]?.status).toBe("unverified");
	expect(
		result.validation["custom:test"]?.issues.map((i) => i.field),
	).toContain("video.options.future");
});

test("missing encoders and mismatched stream scopes are unsupported", async () => {
	const server = unknownMediaCapabilities();
	server.inventory.encoders = { status: "ready", error: null, entries: [] };
	const result = await inspectEncodingProfiles(
		[
			{
				id: "test",
				container: "mp4",
				video: {
					encoder: "missing",
					codec: "h264",
					options: { audio_only: 1 },
				},
				audio: { encoder: "copy", codec: "" },
			},
		],
		server,
		async () =>
			parseOptionHelp(
				"Encoder missing [Missing]:\n -audio_only <int> E...A...... Audio\n",
				true,
			),
	);
	expect(result.validation.test?.status).toBe("unsupported");
});

test("tool metadata shares concurrent requests and refreshes on explicit reload", async () => {
	const server = unknownMediaCapabilities();
	server.inventory.encoders = {
		status: "ready",
		error: null,
		entries: capabilities.parseMediaCapabilities(
			"encoders",
			"Encoders:\n ------\n V..... libx264 Video (codec h264)\n A..... aac AAC",
		),
	};
	const detect = vi
		.spyOn(capabilities, "detectMediaCapabilities")
		.mockResolvedValue(server);
	vi.spyOn(processTools, "resolveExecutable").mockImplementation(
		async (command) => command,
	);
	const help = {
		full: "AVCodecContext AVOptions:\n -b <int64> E..VA...... bitrate",
		"encoder=libx264": "Encoder libx264:\n -crf <float> E..V....... Quality",
		"encoder=aac": "Encoder aac:",
		"muxer=mp4": "Muxer mp4:",
	};
	const run = vi
		.spyOn(processTools, "runTool")
		.mockImplementation(async (path, args) => {
			if (args[0] === "-version")
				return `${path.endsWith("ffmpeg") ? "ffmpeg" : "ffprobe"} version test`;
			const topic = args[2];
			if (!topic || !Object.hasOwn(help, topic))
				throw new Error(`Unexpected tool arguments: ${args.join(" ")}`);
			return help[topic as keyof typeof help];
		});
	const tools = await MediaTools.create({
		ffmpegPath: "/test/ffmpeg",
		ffprobePath: "/test/ffprobe",
	});
	run.mockClear();
	const profiles = [
		{
			id: "custom:runtime",
			container: "mp4",
			video: { encoder: "libx264", codec: "", options: { crf: 24 } },
			audio: { encoder: "aac", codec: "", options: { b: "128k" } },
		},
	];
	const [a, b] = await Promise.all([
		tools.validateProfiles(profiles),
		tools.validateProfiles(profiles),
	]);
	expect(a.profiles[0]?.video.codec).toBe("h264");
	expect(b.profiles[0]?.audio.codec).toBe("aac");
	const topics = () => run.mock.calls.map(([, args]) => args[2]).sort();
	expect(topics()).toEqual(Object.keys(help).sort());
	expect(detect).toHaveBeenCalledTimes(1);
	await tools.validateProfiles(profiles);
	expect(topics()).toEqual(Object.keys(help).sort());
	expect(detect).toHaveBeenCalledTimes(1);
	await tools.validateProfiles(profiles, true);
	expect(topics()).toEqual([...Object.keys(help), ...Object.keys(help)].sort());
	expect(detect).toHaveBeenCalledTimes(2);
});
