import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createLibraryModule } from "../src/bootstrap/library.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
} from "../src/modules/configuration/domain/policy.js";
import type { LibraryApplication } from "../src/modules/library/application/library.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import {
	MediaInspectionApplication,
	MediaInspectionBusyError,
} from "../src/modules/media-inspection/application/inspection.js";
import { SubtitleApplication } from "../src/modules/subtitles/application/subtitles.js";
import {
	type MediaInfo,
	MediaToolError,
	type MediaTools,
} from "../src/platform/media/index.js";
import { settingsStore } from "./settings-store.js";

const info: MediaInfo = {
	format: "matroska",
	duration: 12,
	size: null,
	bitRate: null,
	tags: {},
	streams: [],
};
let root: string;
let library: LibraryApplication;
let inspection: MediaInspectionApplication;
let probe: ReturnType<typeof vi.fn<MediaTools["probe"]>>;
let ids: string[];
const policy = structuredClone(builtinPolicy.media) as BuiltinPolicy["media"];

beforeEach(async () => {
	Object.assign(policy, builtinPolicy.media);
	root = await mkdtemp(join(tmpdir(), "anishelf-media-inspection-"));
	await writeFile(join(root, "first.mkv"), "first source");
	await writeFile(join(root, "second.mkv"), "second source");
	const index = new LibraryIndex();
	library = createLibraryModule({
		index,
		configuration: settingsStore(root),
		logger: pino({ enabled: false }),
	});
	await library.startScan();
	await library.waitForCompletion();
	ids = [...index.snapshot.entriesById.values()]
		.filter((entry) => entry.kind === "file")
		.map((entry) => entry.id);
	probe = vi.fn<MediaTools["probe"]>().mockResolvedValue(info);
	inspection = new MediaInspectionApplication({
		sources: library.sources,
		tools: { probe },
		policy,
	});
});
afterEach(async () => {
	await inspection.close();
	await library.close();
	await rm(root, { recursive: true, force: true });
});

function fileId(index = 0): string {
	const id = ids[index];
	if (!id) throw new Error("Missing fixture file");
	return id;
}

function deferredProbe() {
	let finish!: (result: MediaInfo) => void;
	probe.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	return (result = info) => finish(result);
}

test("shares one probe between subtitle discovery and another consumer", async () => {
	expect(probe).not.toHaveBeenCalled();
	const finish = deferredProbe();
	const subtitles = new SubtitleApplication({
		sources: library.sources,
		inspection,
	});
	const discovery = subtitles.discoverSubtitles(fileId());
	await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
	const otherConsumer = inspection.inspect(fileId());
	const busy = inspection.inspect(fileId(1));
	await expect(busy).rejects.toBeInstanceOf(MediaInspectionBusyError);
	// A consumer does not own or shut down the shared service.
	await subtitles.close();
	finish();
	await expect(discovery).resolves.toMatchObject({ warnings: [] });
	await expect(otherConsumer).resolves.toMatchObject({ info });
	expect(probe).toHaveBeenCalledTimes(1);
	const result = await inspection.inspect(fileId());
	result.info.tags = { changed: "consumer mutation" };
	expect((await inspection.inspect(fileId())).info.tags).toEqual({});
	expect(probe).toHaveBeenCalledTimes(1);
});

test("reprobes replacements and rejects a missing file even with cached metadata", async () => {
	const first = await inspection.inspect(fileId());
	const path = join(root, first.source.identity.relativePath);
	await writeFile(path, "replacement with a different size");
	const next = await inspection.inspect(fileId());
	expect(next.source.identity.sourceVersion).not.toBe(
		first.source.identity.sourceVersion,
	);
	expect(probe).toHaveBeenCalledTimes(2);
	await rm(path);
	await expect(inspection.inspect(fileId())).rejects.toBeDefined();
	expect(probe).toHaveBeenCalledTimes(2);
});

test("rejects an expected-version mismatch without probing", async () => {
	await expect(inspection.inspect(fileId(), "obsolete")).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	expect(probe).not.toHaveBeenCalled();
});

test("does not cache information from a file changed while probing", async () => {
	probe.mockImplementationOnce(async (path) => {
		await writeFile(path, "replacement during inspection");
		return info;
	});
	await expect(inspection.inspect(fileId())).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	await expect(inspection.inspect(fileId())).resolves.toMatchObject({ info });
	expect(probe).toHaveBeenCalledTimes(2);
});

test("rejects a root-epoch change while probing", async () => {
	const finish = deferredProbe();
	const pending = inspection.inspect(fileId());
	const rejected = expect(pending).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
	await library.settings.updateSettings({ resourceRoot: `${root}/.` });
	await library.waitForCompletion();
	finish();
	await rejected;
	await inspection.inspect(fileId());
	expect(probe).toHaveBeenCalledTimes(2);
});

test("retries failed probes and releases the slot", async () => {
	probe.mockRejectedValueOnce(
		new MediaToolError("TOOL_FAILED", "Probe failed."),
	);
	await expect(inspection.inspect(fileId())).rejects.toMatchObject({
		code: "TOOL_FAILED",
	});
	await expect(inspection.inspect(fileId())).resolves.toMatchObject({ info });
	await expect(inspection.inspect(fileId(1))).resolves.toMatchObject({ info });
	expect(probe).toHaveBeenCalledTimes(3);
});

test("bounds cached entries while retaining cached access when slots are occupied", async () => {
	policy.maximumProbeCacheEntries = 1;
	await inspection.inspect(fileId());
	const finish = deferredProbe();
	const second = inspection.inspect(fileId(1));
	await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
	await expect(inspection.inspect(fileId())).resolves.toMatchObject({ info });
	finish();
	await second;
	await inspection.inspect(fileId());
	expect(probe).toHaveBeenCalledTimes(3);
});

test("shutdown aborts and awaits active probes and rejects new work", async () => {
	let abortObserved = false;
	let finish!: () => void;
	probe.mockImplementationOnce(
		(_path, signal) =>
			new Promise((_resolve, reject) => {
				signal?.addEventListener(
					"abort",
					() => {
						abortObserved = true;
						finish = () =>
							reject(new MediaToolError("TOOL_FAILED", "Aborted."));
					},
					{ once: true },
				);
			}),
	);
	const pending = inspection.inspect(fileId());
	const rejected = expect(pending).rejects.toMatchObject({
		code: "TOOL_FAILED",
	});
	await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
	let closed = false;
	const closing = inspection.close().then(() => {
		closed = true;
	});
	expect(abortObserved).toBe(true);
	expect(closed).toBe(false);
	await expect(inspection.inspect(fileId())).rejects.toMatchObject({
		code: "TOOL_UNAVAILABLE",
	});
	finish();
	await closing;
	await rejected;
	expect(closed).toBe(true);
});
