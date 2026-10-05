import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { createLibraryModule } from "../src/bootstrap/library.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import { MediaInspectionApplication } from "../src/modules/media-inspection/application/inspection.js";
import { MediaProcessingApplication } from "../src/modules/media-processing/application/processing.js";
import { parseMediaInfo } from "../src/platform/media/tools.js";
import { unknownMediaCapabilities } from "../src/shared/media-capabilities.js";
import type { MediaProcessingPlan } from "../src/shared/media-processing.js";
import { settingsStore } from "./settings-store.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((fn) => fn()));
});
async function fixture(block = false) {
	const root = await mkdtemp(join(tmpdir(), "anishelf-processing-app-"));
	await writeFile(join(root, "source.mp4"), "source");
	const index = new LibraryIndex();
	const library = createLibraryModule({
		index,
		configuration: settingsStore(root),
		logger: pino({ enabled: false }),
	});
	await library.startScan();
	await library.waitForCompletion();
	const file = [...index.snapshot.entriesById.values()].find(
		(e) => e.kind === "file",
	);
	if (!file) throw new Error("Missing fixture file");
	const source = await library.sources.resolveSource(file.id);
	const info = parseMediaInfo(
		JSON.stringify({
			format: { format_name: "matroska", duration: "1" },
			streams: [{ index: 0, codec_type: "video", codec_name: "h264" }],
		}),
	);
	const inspection = new MediaInspectionApplication({
		sources: library.sources,
		tools: { probe: vi.fn().mockResolvedValue(info) },
	});
	let entered!: () => void;
	const entry = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const executeMedia = vi.fn(async (_input, output, options) => {
		await writeFile(output, "processed");
		options.onEvent?.({ type: "started", pid: 123 });
		entered();
		if (block)
			await new Promise<void>((_resolve, reject) => {
				if (options.signal.aborted) reject(options.signal.reason);
				else
					options.signal.addEventListener(
						"abort",
						() => reject(options.signal.reason),
						{ once: true },
					);
			});
		options.onEvent?.({
			type: "closed",
			exitCode: 0,
			signal: null,
			reason: null,
		});
		return;
	});
	const capabilities = unknownMediaCapabilities();
	capabilities.tools.ffmpeg.available =
		capabilities.tools.ffprobe.available = true;
	for (const category of Object.values(capabilities.inventory))
		category.status = "ready";
	for (const [kind, name, flags] of [
		["demuxers", "matroska", ""],
		["muxers", "matroska", ""],
		["protocols", "file", "IO"],
		["protocols", "pipe", "O"],
	] as const)
		capabilities.inventory[kind].entries.push({
			name,
			flags,
			description: "",
			codec: null,
			mediaType: null,
		});
	const outputProbe = vi.fn().mockResolvedValue(info);
	const application = new MediaProcessingApplication({
		sources: library.sources,
		inspection,
		tools: {
			capabilities: vi.fn().mockResolvedValue(capabilities),
			probe: outputProbe,
		},
		executor: { execute: executeMedia },
		dataDir: root,
	});
	cleanup.push(async () => {
		await application.close();
		await inspection.close();
		await library.close();
		await rm(root, { recursive: true, force: true });
	});
	const request = {
		fileId: file.id,
		sourceVersion: source.identity.sourceVersion,
		plan: {
			id: "caller-selected",
			container: "matroska",
			outputFormat: "matroska",
			video: { action: "copy" },
			audio: { action: "copy" },
			filters: [],
		} as MediaProcessingPlan,
		videoStreamIndex: 0,
		audioStreamIndices: [],
	};
	return {
		application,
		request,
		root,
		entry,
		executeMedia,
		sources: library.sources,
		capabilities,
		info,
		outputProbe,
	};
}
test("explicit execution publishes a version-bound result and owns a cloned plan", async () => {
	const f = await fixture();
	const states: string[] = [];
	const plan = structuredClone(f.request.plan) as MediaProcessingPlan;
	const handle = f.application.start({
		...f.request,
		plan,
		onEvent(event) {
			if (event.type === "state") states.push(event.state);
		},
	});
	plan.id = "changed";
	const result = await handle.completion;
	expect(result.id).toBe(handle.id);
	expect(result.planId).toBe("caller-selected");
	expect(handle.state).toBe("ready");
	expect(states).toEqual(["checking", "starting", "validating", "ready"]);
	expect((await stat(result.output.path)).size).toBeGreaterThan(0);
	await f.application.release(result.id);
	await expect(stat(result.output.path)).rejects.toMatchObject({
		code: "ENOENT",
	});
});
test("stop waits for failure cleanup and the concurrency slot becomes available", async () => {
	const f = await fixture(true);
	const handle = f.application.start(f.request);
	await f.entry;
	expect(() => f.application.start(f.request)).toThrow("busy");
	await handle.stop();
	expect(handle.state).toBe("cancelled");
	await expect(handle.completion).rejects.toBeDefined();
	expect(await readdir(join(f.root, "cache", "media-processing"))).toEqual([]);
	const next = f.application.start({
		...f.request,
		signal: AbortSignal.abort(),
	});
	await next.stop();
});
test("source conflicts discard output before ready", async () => {
	const f = await fixture();
	const execute = f.executeMedia.getMockImplementation();
	if (!execute) throw new Error("Missing fixture executor");
	f.executeMedia.mockImplementationOnce(async (...args) => {
		const result = await execute(...args);
		vi.spyOn(f.sources, "revalidateSource").mockRejectedValue(
			new Error("source conflict"),
		);
		return result;
	});
	const handle = f.application.start(f.request);
	await expect(handle.completion).rejects.toThrow("source conflict");
	expect(handle.state).toBe("failed");
	expect(await readdir(join(f.root, "cache", "media-processing"))).toEqual([]);
});

test.each(["ready", "failed"] as const)(
	"preflight %s failures do not invoke the adapter or allocate output",
	async (status) => {
		const f = await fixture();
		f.capabilities.inventory.muxers = { status, entries: [], error: null };
		const handle = f.application.start(f.request);
		await expect(handle.completion).rejects.toMatchObject({
			code: status === "ready" ? "CAPABILITY_MISSING" : "CAPABILITY_UNKNOWN",
		});
		expect(f.executeMedia).not.toHaveBeenCalled();
		await expect(
			stat(join(f.root, "cache", "media-processing")),
		).rejects.toMatchObject({ code: "ENOENT" });
	},
);
test("output container mismatch is rejected and removed", async () => {
	const f = await fixture();
	f.request.plan.outputFormat = "different-format";

	const handle = f.application.start(f.request);
	await expect(handle.completion).rejects.toMatchObject({
		code: "TOOL_FAILED",
	});
	expect(handle.state).toBe("failed");
	expect(await readdir(join(f.root, "cache", "media-processing"))).toEqual([]);
});

test.each(["count", "codec", "channels", "duration"])(
	"rejects invalid second output audio track: %s",
	async (failure) => {
		const f = await fixture();
		const tracks = parseMediaInfo(
			JSON.stringify({
				format: { format_name: "matroska" },
				streams: [
					{
						index: 1,
						codec_type: "audio",
						codec_name: "aac",
						channels: 2,
						duration: "10",
					},
					{
						index: 3,
						codec_type: "audio",
						codec_name: "ac3",
						channels: 6,
						duration: "10",
					},
				],
			}),
		).streams;
		f.info.streams.push(...tracks);
		const output = structuredClone(f.info);
		const second = output.streams[2];
		if (!second) throw new Error("Missing second audio");
		if (failure === "count") output.streams.pop();
		if (failure === "codec") second.codec = "opus";
		if (failure === "channels") second.channels = 2;
		if (failure === "duration") second.duration = 100;
		f.outputProbe.mockResolvedValue(output);
		const handle = f.application.start({
			...f.request,
			audioStreamIndices: [1, 3],
		});
		await expect(handle.completion).rejects.toMatchObject({
			code: "TOOL_FAILED",
		});
		expect(await readdir(join(f.root, "cache", "media-processing"))).toEqual(
			[],
		);
	},
);
