import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type BuiltinPolicy, builtinPolicy } from "../src/app/policy.js";
import { MediaInspectionApplication } from "../src/modules/media/media-inspection/application.js";
import { MediaInspectionBusyError } from "../src/modules/media/media-inspection/public.js";
import type { LibraryApplication } from "../src/modules/resources/library/application/library.js";
import { LibraryIndex } from "../src/modules/resources/library/infrastructure/index.js";
import { ResourceAccess } from "../src/modules/resources/resource-access/infrastructure/access.js";
import {
	type MediaInfo,
	MediaToolError,
	type MediaTools,
} from "../src/platform/media/index.js";
import { settingsStore } from "./settings-store.js";
import { createHttpApp } from "./support/http.js";
import { MemoryInspectionStore } from "./support/inspection-store.js";
import { createLibraryModule } from "./support/library.js";
import { updateResourceSettings } from "./support/settings.js";
import { createSubtitleApplication } from "./support/subtitles.js";

const info: MediaInfo = {
	format: "matroska",
	formatAliases: ["matroska"],
	container: "matroska",
	duration: 12,
	size: null,
	bitRate: null,
	tags: {},
	chapters: [],
	streams: [],
};
let root: string;
let library: LibraryApplication;
let inspection: MediaInspectionApplication;
let probe: ReturnType<typeof vi.fn<MediaTools["probe"]>>;
let ids: string[];
const policy = structuredClone(
	builtinPolicy.mediaInspection,
) as BuiltinPolicy["mediaInspection"];

beforeEach(async () => {
	Object.assign(policy, builtinPolicy.mediaInspection);
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
		repository: new MemoryInspectionStore(),
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
	policy.probeConcurrency = 1;
	expect(probe).not.toHaveBeenCalled();
	const finish = deferredProbe();
	const subtitles = createSubtitleApplication({
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
	await updateResourceSettings(library, {
		resourceRoots: [`${root}/.`],
	});
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

test("retains persisted entries when probe slots are occupied", async () => {
	await inspection.inspect(fileId());
	const finish = deferredProbe();
	const second = inspection.inspect(fileId(1));
	await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
	await expect(inspection.inspect(fileId())).resolves.toMatchObject({ info });
	finish();
	await second;
	await inspection.inspect(fileId());
	expect(probe).toHaveBeenCalledTimes(2);
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

test("probe misses validate before and after processing; cache hits need one current read", async () => {
	const reads = vi.spyOn(
		ResourceAccess.prototype,
		"inspectVideoFileWithVersion",
	);
	try {
		await inspection.inspect(fileId());
		expect(reads).toHaveBeenCalledTimes(3);
		reads.mockClear();
		await inspection.inspect(fileId());
		expect(reads).toHaveBeenCalledTimes(1);
		expect(probe).toHaveBeenCalledTimes(1);
	} finally {
		reads.mockRestore();
	}
});

test("serves version-bound chapters with access validation and shared cache", async () => {
	probe.mockResolvedValueOnce({
		...info,
		chapters: [{ title: "Opening", startMs: 0, endMs: 1000 }],
	});
	const inspected = await inspection.inspect(fileId());
	const version = inspected.source.identity.sourceVersion;
	const app = createHttpApp({
		config: {
			host: "127.0.0.1",
			port: 80,
			publicOrigin: "http://localhost",
		},
		logger: pino({ enabled: false }),
		inspection,
	});
	try {
		const url = `/api/files/${fileId()}/chapters?sourceVersion=${version}`;
		const response = await app.inject({ url });
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			sourceVersion: version,
			chapters: [{ title: "Opening", startMs: 0, endMs: 1000 }],
		});
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(probe).toHaveBeenCalledTimes(1);
		expect(
			(
				await app.inject({
					url: `/api/files/${fileId()}/chapters?sourceVersion=obsolete`,
				})
			).statusCode,
		).toBe(409);
		expect(
			(await app.inject({ url: `/api/files/${fileId()}/chapters` })).statusCode,
		).toBe(400);
		const other = await library.sources.resolveSource(fileId(1));
		probe.mockRejectedValueOnce(new MediaToolError("TOOL_FAILED", "failed"));
		const unavailable = await app.inject({
			url: `/api/files/${fileId(1)}/chapters?sourceVersion=${other.identity.sourceVersion}`,
		});
		expect(unavailable.statusCode).toBe(503);
		expect(unavailable.json().error.code).toBe("MEDIA_INSPECTION_UNAVAILABLE");
	} finally {
		await app.close();
	}
});

test("reuses SQLite inspections after reopen, replaces changed versions and prunes only confirmed deletions", async () => {
	const { ApplicationDatabase } = await import(
		"../src/app/bootstrap/database.js"
	);
	const directory = join(root, "database");
	let database = ApplicationDatabase.open(directory);
	await inspection.close();
	const create = (cacheVersion = "probe:test") =>
		new MediaInspectionApplication({
			sources: library.sources,
			tools: { probe },
			repository: database.inspections,
			cacheVersion,
		});
	inspection = create();
	const first = await inspection.inspect(fileId());
	await inspection.close();
	database.close();
	database = ApplicationDatabase.open(directory);
	try {
		inspection = create();
		await inspection.inspect(fileId());
		expect(probe).toHaveBeenCalledTimes(1);
		await inspection.close();
		inspection = create("probe:updated");
		await inspection.inspect(fileId());
		expect(probe).toHaveBeenCalledTimes(2);
		const record = database.inspections.find(
			first.source.identity.scopeId,
			fileId(),
		);
		expect(record?.formatVersion).toBe("probe:updated");
		await writeFile(
			join(root, first.source.identity.relativePath),
			"replacement with new dimensions",
		);
		const replacement = await inspection.inspect(fileId());
		expect(probe).toHaveBeenCalledTimes(3);
		expect(
			database.inspections.find(first.source.identity.scopeId, fileId())
				?.sourceVersion,
		).toBe(replacement.source.identity.sourceVersion);
		await rm(join(root, first.source.identity.relativePath));
		await library.startScan();
		await library.waitForCompletion();
		const status = await library.getStatus();
		await inspection.reconcile({
			getStatus: async () => ({ ...status, stale: true }),
			readFilePage: library.readFilePage.bind(library),
		});
		expect(
			database.inspections.find(first.source.identity.scopeId, fileId()),
		).not.toBeNull();
		await inspection.reconcile(library);
		expect(
			database.inspections.find(first.source.identity.scopeId, fileId()),
		).toBeNull();
		database.inspections.save({
			scopeId: "offline-root",
			fileId: "offline",
			sourceVersion: "v",
			formatVersion: "probe:test",
			info,
		});
		database.inspections.save({
			scopeId: "removed-root",
			fileId: "removed",
			sourceVersion: "v",
			formatVersion: "probe:test",
			info,
		});
		expect(
			database.inspections.reconcile([], new Map(), ["offline-root"]),
		).toBe(1);
		expect(database.inspections.find("offline-root", "offline")).not.toBeNull();
	} finally {
		await inspection.close();
		database.close();
	}
});

test("cache storage errors do not discard a successful probe", async () => {
	await inspection.close();
	const repository = new MemoryInspectionStore();
	vi.spyOn(repository, "find").mockImplementation(() => {
		throw new Error("Read failed");
	});
	vi.spyOn(repository, "save").mockImplementation(() => {
		throw new Error("Disk full");
	});
	inspection = new MediaInspectionApplication({
		sources: library.sources,
		tools: { probe },
		repository,
	});
	expect((await inspection.inspect(fileId())).info).toEqual(info);
	expect(probe).toHaveBeenCalledTimes(1);
});

test("startup without a published library cannot establish cache deletion", async () => {
	const sources = library.sources;
	const repository = new MemoryInspectionStore();
	const first = await inspection.inspect(fileId());
	repository.save({
		scopeId: first.source.identity.scopeId,
		fileId: fileId(),
		sourceVersion: first.source.identity.sourceVersion,
		formatVersion: "probe:1",
		info,
	});
	const unscanned = createLibraryModule({
		index: new LibraryIndex(),
		configuration: settingsStore(root),
		logger: pino({ enabled: false }),
	});
	await inspection.close();
	inspection = new MediaInspectionApplication({
		sources: unscanned.sources,
		tools: { probe },
		repository,
	});
	try {
		await inspection.reconcile(unscanned);
		expect(
			repository.find(first.source.identity.scopeId, fileId()),
		).not.toBeNull();
		await unscanned.startScan();
		await unscanned.waitForCompletion();
		await inspection.reconcile(unscanned);
		expect(
			repository.find(first.source.identity.scopeId, fileId()),
		).not.toBeNull();
		expect((await inspection.inspect(fileId())).info).toEqual(info);
		expect(probe).toHaveBeenCalledTimes(1);
	} finally {
		await unscanned.close();
	}
	expect(sources.hasSnapshot).toBe(true);
});
