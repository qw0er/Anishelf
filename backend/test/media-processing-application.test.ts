import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { createLibraryModule } from "../src/bootstrap/library.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import { MediaInspectionApplication } from "../src/modules/media-inspection/application/inspection.js";
import {
	MediaProcessingApplication,
	mediaProcessingPolicy,
	resolveMediaProcessingPlan,
} from "../src/modules/media-processing/public.js";
import { parseMediaInfo } from "../src/platform/media/tools.js";
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
			format: { format_name: "mp4", duration: "1" },
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
	const processMedia = vi.fn(async (_input, output, options) => {
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
		return info;
	});
	const application = new MediaProcessingApplication({
		sources: library.sources,
		inspection,
		tools: { processMedia },
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
		plan: resolveMediaProcessingPlan(mediaProcessingPolicy, "remux"),
		videoStreamIndex: 0,
		audioStreamIndex: null,
	};
	return {
		application,
		request,
		root,
		entry,
		processMedia,
		sources: library.sources,
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
	plan.profile.id = "changed-v2";
	const result = await handle.completion;
	expect(result.id).toBe(handle.id);
	expect(result.profileId).toBe("mp4-h264-aac-v1");
	expect(handle.state).toBe("ready");
	expect(states).toEqual(["checking", "starting", "validating", "ready"]);
	expect((await stat(result.path)).size).toBeGreaterThan(0);
	await f.application.release(result.id);
	await expect(stat(result.path)).rejects.toMatchObject({ code: "ENOENT" });
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
	const execute = f.processMedia.getMockImplementation();
	if (!execute) throw new Error("Missing fixture executor");
	f.processMedia.mockImplementationOnce(async (...args) => {
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
