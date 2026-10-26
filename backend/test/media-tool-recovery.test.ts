import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as capabilities from "../src/platform/media/capabilities.js";
import { unknownMediaCapabilities } from "../src/platform/media/capability-model.js";
import { mediaToolPolicy } from "../src/platform/media/policy.js";
import * as processTools from "../src/platform/media/process.js";
import { MediaTools } from "../src/platform/media/tools.js";

let now: number;
let fail: boolean;
let fixture: string;
const config = { ffmpegPath: "/test/ffmpeg", ffprobePath: "/test/ffprobe" };

beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-tool-recovery-"));
	now = Date.now();
	fail = true;
	vi.spyOn(Date, "now").mockImplementation(() => now);
	vi.spyOn(processTools, "resolveExecutable").mockImplementation(
		async (command) => command,
	);
	vi.spyOn(processTools, "runTool").mockImplementation(async (path, args) => {
		if (args[0] === "-version") {
			if (fail)
				throw new Error("Detection timed out", { cause: new Error("SIGKILL") });
			return `${path.endsWith("ffmpeg") ? "ffmpeg" : "ffprobe"} version test`;
		}
		return JSON.stringify({ format: { format_name: "matroska" }, streams: [] });
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(fixture, { recursive: true, force: true });
});

test("recovers probing after startup detection failure without restarting", async () => {
	const logs: string[] = [];
	const logger = pino({}, { write: (line) => logs.push(line) });
	const tools = await MediaTools.create(config, undefined, undefined, logger);
	expect(tools.status.ffprobe.available).toBe(false);
	expect(logs.map((line) => JSON.parse(line))).toContainEqual(
		expect.objectContaining({
			event: "media.tool_detection_failed",
			tool: "ffprobe",
			err: expect.objectContaining({
				message: expect.stringContaining("Detection timed out"),
			}),
		}),
	);
	fail = false;
	now += mediaToolPolicy.detectionRetryIntervalMs;
	const path = join(fixture, "video.mkv");
	await writeFile(path, "test fixture");
	await expect(tools.probe(path)).resolves.toMatchObject({
		format: "matroska",
	});
	expect(tools.status.ffprobe.available).toBe(true);
	expect(logs.map((line) => JSON.parse(line))).toContainEqual(
		expect.objectContaining({ event: "media.tool_recovered", tool: "ffprobe" }),
	);
});

test("coalesces concurrent retries and applies a cooldown after each failure", async () => {
	const tools = await MediaTools.create(config);
	const run = vi.mocked(processTools.runTool);
	run.mockClear();
	await Promise.all(
		Array.from({ length: 10 }, () => tools.toolStatus("ffprobe")),
	);
	expect(run).not.toHaveBeenCalled();
	now += mediaToolPolicy.detectionRetryIntervalMs;
	const failed = await Promise.all(
		Array.from({ length: 10 }, () => tools.toolStatus("ffprobe")),
	);
	expect(failed.every((status) => !status.available)).toBe(true);
	expect(run).toHaveBeenCalledTimes(1);
	fail = false;
	await tools.toolStatus("ffprobe");
	expect(run).toHaveBeenCalledTimes(1);
	now += mediaToolPolicy.detectionRetryIntervalMs;
	const recovered = await Promise.all(
		Array.from({ length: 10 }, () => tools.toolStatus("ffprobe")),
	);
	expect(recovered.every((status) => status.available)).toBe(true);
	expect(run).toHaveBeenCalledTimes(2);
	now += mediaToolPolicy.detectionRetryIntervalMs;
	await tools.toolStatus("ffprobe");
	expect(run).toHaveBeenCalledTimes(2);
});

test("rebuilds cached capabilities after recovery and shares the new enumeration", async () => {
	const detect = vi
		.spyOn(capabilities, "detectMediaCapabilities")
		.mockImplementation(async (tools) => {
			const result = unknownMediaCapabilities();
			result.tools.ffmpeg.available = tools.ffmpeg.available;
			result.tools.ffprobe.available = tools.ffprobe.available;
			return result;
		});
	const tools = await MediaTools.create(config);
	expect((await tools.capabilities()).tools.ffmpeg.available).toBe(false);
	await tools.capabilities();
	expect(detect).toHaveBeenCalledTimes(1);
	fail = false;
	now += mediaToolPolicy.detectionRetryIntervalMs;
	const [first, second] = await Promise.all([
		tools.capabilities(),
		tools.capabilities(),
	]);
	expect(first.tools.ffmpeg.available).toBe(true);
	expect(first.tools.ffprobe.available).toBe(true);
	expect(second).toEqual(first);
	expect(second).not.toBe(first);
	expect(detect).toHaveBeenCalledTimes(2);
});

test("keeps an invalid explicit path unavailable instead of falling back to PATH", async () => {
	const resolve = vi
		.mocked(processTools.resolveExecutable)
		.mockRejectedValue(new Error("Not executable"));
	const tools = await MediaTools.create(config);
	resolve.mockClear();
	now += mediaToolPolicy.detectionRetryIntervalMs;
	await expect(tools.probe(join(fixture, "video.mkv"))).rejects.toMatchObject({
		code: "TOOL_UNAVAILABLE",
	});
	expect(resolve).toHaveBeenCalledExactlyOnceWith(
		config.ffprobePath,
		expect.any(Object),
	);
	expect(processTools.runTool).not.toHaveBeenCalled();
});
