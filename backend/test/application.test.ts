import {
	mkdir,
	mkdtemp,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LibraryApplication } from "../src/application/library.js";
import { DomainError } from "../src/errors.js";
import { LibraryIndex } from "../src/library/index.js";
import { createResourceId } from "../src/library/model.js";
import { ResourceAccess } from "../src/resources/access.js";

let fixture: string;
let root: string;
let index: LibraryIndex;
let libraryApp: LibraryApplication;
beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-scan-"));
	root = join(fixture, "media");
	await mkdir(root);
	index = new LibraryIndex();
	libraryApp = new LibraryApplication({
		index,
		configuration: {
			get settings() {
				return { resourceRoot: root };
			},
			async update(next) {
				if (next.resourceRoot === null)
					throw new Error("Expected a configured root");
				root = next.resourceRoot;
				return next;
			},
		},
		logger: pino({ enabled: false }),
	});
});
afterEach(async () => {
	await libraryApp.close();
	vi.restoreAllMocks();
	await rm(fixture, { recursive: true, force: true });
});

test("scans nested directories and allowed video types, skipping symlinks and other files", async () => {
	await mkdir(join(root, "中文 folder"));
	await mkdir(join(root, "empty"));
	await writeFile(join(root, "中文 folder", "episode 2.MP4"), "video");
	await writeFile(join(root, "episode 10.mkv"), "video");
	await writeFile(join(root, "episode.webm"), "video");
	await writeFile(join(root, "episode.m4v"), "video");
	await writeFile(join(root, "notes.txt"), "text");
	await symlink(join(root, "中文 folder"), join(root, "link"), "dir");
	expect(libraryApp.state).toBeNull();
	expect((await libraryApp.startScan()).status).toBe("running");
	expect(await libraryApp.waitForCompletion()).toMatchObject({
		status: "completed",
		visitedCount: 8,
		matchedCount: 4,
		warnings: { count: 0, messages: [] },
	});
	expect(index.revision).toBe(1);
	expect(index.snapshot.entriesById.size).toBe(7);
	expect(
		index.getFile(
			createResourceId("file", join("中文 folder", "episode 2.MP4")),
		),
	).toMatchObject({ sizeBytes: 5, mimeType: "video/mp4" });
	expect(index.listChildren(createResourceId("directory", "empty"))).toEqual(
		[],
	);
});

test("an empty directory is a successful scan", async () => {
	await libraryApp.startScan();
	expect(await libraryApp.waitForCompletion()).toMatchObject({
		status: "completed",
		matchedCount: 0,
	});
	expect(index.revision).toBe(1);
	expect(index.listChildren("root")).toEqual([]);
});

test("reuses the active scan and replaces additions and removals without duplicate paths", async () => {
	await writeFile(join(root, "kept.mp4"), "video");
	await writeFile(join(root, "old.mp4"), "video");
	const first = await libraryApp.startScan();
	expect((await libraryApp.startScan()).id).toBe(first.id);
	await libraryApp.waitForCompletion();
	await rm(join(root, "old.mp4"));
	await writeFile(join(root, "new.mp4"), "video");
	const second = await libraryApp.startScan();
	expect(second.id).not.toBe(first.id);
	expect(index.getFile(createResourceId("file", "old.mp4"))).toBeDefined();
	await libraryApp.waitForCompletion();
	expect(index.revision).toBe(2);
	expect(index.listChildren("root").map((entry) => entry.name)).toEqual([
		"kept.mp4",
		"new.mp4",
	]);
});

test("a missing root fails the rescan, keeps the old snapshot, and can recover", async () => {
	await writeFile(join(root, "kept.mp4"), "video");
	await libraryApp.startScan();
	await libraryApp.waitForCompletion();
	const previous = index.snapshot;
	await rename(root, join(fixture, "backup"));
	await expect(libraryApp.startScan()).rejects.toMatchObject({
		code: "RESOURCE_ROOT_UNAVAILABLE",
	});
	expect(index.snapshot).toEqual(previous);
	expect(JSON.stringify(libraryApp.state)).not.toContain(fixture);
	await rename(join(fixture, "backup"), root);
	await libraryApp.startScan();
	expect((await libraryApp.waitForCompletion())?.status).toBe("completed");
});

test("child access failures produce a partial snapshot and safe warning summaries", async () => {
	await mkdir(join(root, "blocked"));
	await writeFile(join(root, "blocked", "hidden.mp4"), "video");
	await writeFile(join(root, "removed.mp4"), "video");
	await writeFile(join(root, "good.mp4"), "video");
	const resources = await ResourceAccess.create({ resourceRoot: root });
	const readDirectory = resources.readDirectory.bind(resources);
	const inspectFile = resources.inspectVideoFile.bind(resources);
	vi.spyOn(ResourceAccess, "create").mockResolvedValue(resources);
	vi.spyOn(resources, "readDirectory").mockImplementation(async (path = "") => {
		if (path === "blocked")
			throw new DomainError("RESOURCE_UNREADABLE", `secret ${fixture}`);
		return readDirectory(path);
	});
	vi.spyOn(resources, "inspectVideoFile").mockImplementation(async (path) => {
		if (path === "removed.mp4")
			throw new DomainError("RESOURCE_MISSING", `secret ${fixture}`);
		return inspectFile(path);
	});
	await libraryApp.startScan();
	expect(await libraryApp.waitForCompletion()).toMatchObject({
		status: "completed",
		matchedCount: 1,
		warnings: { count: 2 },
	});
	expect(index.listChildren("root").map((entry) => entry.name)).toEqual([
		"good.mp4",
	]);
	expect(JSON.stringify(libraryApp.state)).not.toContain("secret");
	expect(JSON.stringify(libraryApp.state)).not.toContain(fixture);
});

test("losing the root during traversal fails instead of publishing a partial result", async () => {
	await writeFile(join(root, "episode.mp4"), "video");
	const resources = await ResourceAccess.create({ resourceRoot: root });
	const inspectVideoFile = resources.inspectVideoFile.bind(resources);
	vi.spyOn(ResourceAccess, "create").mockResolvedValue(resources);
	vi.spyOn(resources, "inspectVideoFile").mockImplementation(async (path) => {
		const result = await inspectVideoFile(path);
		await rename(root, join(fixture, "moved"));
		return result;
	});
	await libraryApp.startScan();
	expect(await libraryApp.waitForCompletion()).toMatchObject({
		status: "failed",
		error: { code: "RESOURCE_ROOT_UNAVAILABLE" },
	});
	expect(index.revision).toBe(0);
});

test("bounds concurrent resource access and publishes after outstanding work finishes", async () => {
	for (let count = 0; count < 20; count++)
		await writeFile(join(root, `episode ${count}.mp4`), "video");
	const resources = await ResourceAccess.create({ resourceRoot: root });
	vi.spyOn(ResourceAccess, "create").mockResolvedValue(resources);
	const inspectVideoFile = resources.inspectVideoFile.bind(resources);
	let active = 0;
	let maximum = 0;
	vi.spyOn(resources, "inspectVideoFile").mockImplementation(async (path) => {
		active++;
		maximum = Math.max(maximum, active);
		try {
			return await inspectVideoFile(path);
		} finally {
			active--;
		}
	});
	await libraryApp.startScan();
	expect((await libraryApp.waitForCompletion())?.status).toBe("completed");
	expect(maximum).toBe(8);
	expect(active).toBe(0);
	expect(index.listChildren("root")).toHaveLength(20);
});

test("cancellation discards the candidate and allows another scan", async () => {
	await writeFile(join(root, "episode.mp4"), "video");
	await libraryApp.startScan();
	await libraryApp.cancelScan();
	expect(libraryApp.state?.status).toBe("cancelled");
	expect(index.revision).toBe(0);
	await libraryApp.startScan();
	expect((await libraryApp.waitForCompletion())?.status).toBe("completed");
});

test("shutdown waits for active operations and rejects new scans", async () => {
	await writeFile(join(root, "episode.mp4"), "video");
	const resources = await ResourceAccess.create({ resourceRoot: root });
	vi.spyOn(ResourceAccess, "create").mockResolvedValue(resources);
	let entered: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let release: () => void = () => {};
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const inspectVideoFile = resources.inspectVideoFile.bind(resources);
	vi.spyOn(resources, "inspectVideoFile").mockImplementation(async (path) => {
		entered();
		await pending;
		return inspectVideoFile(path);
	});
	await libraryApp.startScan();
	await started;
	const closed = libraryApp.close();
	release();
	await closed;
	expect(libraryApp.state?.status).toBe("cancelled");
	expect(index.revision).toBe(0);
	await expect(libraryApp.startScan()).rejects.toThrow();
});

test("settings changes during a scan prevent publication and the next scan uses the new root", async () => {
	await writeFile(join(root, "episode.mp4"), "video");
	const nextRoot = join(fixture, "next");
	await mkdir(nextRoot);
	const resources = await ResourceAccess.create({ resourceRoot: root });
	const inspectVideoFile = resources.inspectVideoFile.bind(resources);
	const create = vi
		.spyOn(ResourceAccess, "create")
		.mockResolvedValue(resources);
	vi.spyOn(resources, "inspectVideoFile").mockImplementation(async (path) => {
		const result = await inspectVideoFile(path);
		root = nextRoot;
		return result;
	});
	await libraryApp.startScan();
	expect((await libraryApp.waitForCompletion())?.status).toBe("failed");
	expect(index.revision).toBe(0);
	create.mockRestore();
	await libraryApp.startScan();
	expect((await libraryApp.waitForCompletion())?.status).toBe("completed");
	expect(index.getDirectory("root").name).toBe("next");
});

test("returned scan state cannot mutate internal progress or warnings", async () => {
	const state = await libraryApp.startScan();
	state.warnings.count = 999;
	(state.warnings.messages as string[]).push("changed");
	expect(libraryApp.state?.warnings).toEqual({ count: 0, messages: [] });
	await libraryApp.waitForCompletion();
});

test("direct callers coalesce root preflight and exclude settings saves before traversal", async () => {
	const accessModule = await import("../src/resources/access.js");
	const check = accessModule.checkResourceRoot;
	let release = () => {};
	let entered = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const checking = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const preflight = vi
		.spyOn(accessModule, "checkResourceRoot")
		.mockImplementation(async (settings) => {
			entered();
			await gate;
			return check(settings);
		});
	const pending = Promise.all([
		libraryApp.startScan(),
		libraryApp.startScan(),
		libraryApp.startScan(),
	]);
	await checking;
	try {
		expect(libraryApp.state).toBeNull();
		await expect(
			libraryApp.updateSettings({ resourceRoot: join(fixture, "next") }),
		).rejects.toMatchObject({ code: "SETTINGS_BUSY" });
		expect(root).toBe(join(fixture, "media"));
		expect(preflight).toHaveBeenCalledTimes(1);
	} finally {
		release();
	}
	const scans = await pending;
	expect(new Set(scans.map((scan) => scan.id)).size).toBe(1);
	await libraryApp.waitForCompletion();
	expect(index.revision).toBe(1);
});

test("rejected preflight releases the operation without discarding the previous snapshot", async () => {
	await writeFile(join(root, "kept.mp4"), "video");
	await libraryApp.startScan();
	await libraryApp.waitForCompletion();
	const previous = index.snapshot;
	const state = libraryApp.state;
	await rm(root, { recursive: true });
	await expect(libraryApp.startScan()).rejects.toMatchObject({
		code: "RESOURCE_ROOT_UNAVAILABLE",
	});
	expect(libraryApp.state).toEqual(state);
	expect(index.snapshot).toEqual(previous);
	const next = join(fixture, "next");
	await mkdir(next);
	await libraryApp.updateSettings({ resourceRoot: next });
	expect(libraryApp.state).not.toBeNull();
	await libraryApp.waitForCompletion();
	expect(index.getDirectory("root").name).toBe("next");
});

test("closing during root preflight waits and prevents a late scan from starting", async () => {
	const accessModule = await import("../src/resources/access.js");
	let release = () => {};
	let entered = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const checking = new Promise<void>((resolve) => {
		entered = resolve;
	});
	vi.spyOn(accessModule, "checkResourceRoot").mockImplementation(async () => {
		entered();
		await gate;
		return null;
	});
	const start = libraryApp.startScan();
	const rejected = expect(start).rejects.toMatchObject({ code: "SCAN_FAILED" });
	await checking;
	let stopped = false;
	const closing = libraryApp.close().then(() => {
		stopped = true;
	});
	try {
		await expect(libraryApp.startScan()).rejects.toThrow("shutting down");
		await expect(
			libraryApp.updateSettings({ resourceRoot: root }),
		).rejects.toMatchObject({ code: "SETTINGS_BUSY" });
		expect(stopped).toBe(false);
	} finally {
		release();
		await closing;
	}
	await rejected;
	expect(libraryApp.state).toBeNull();
	expect(index.revision).toBe(0);
});

test("direct settings saves exclude scans and shutdown waits for the save to settle", async () => {
	const accessModule = await import("../src/resources/access.js");
	const preflight = vi.spyOn(accessModule, "checkResourceRoot");
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const configuration = {
		settings: { resourceRoot: root },
		async update(next: { resourceRoot: string | null }) {
			await gate;
			if (next.resourceRoot === null) throw new Error("Expected a root");
			this.settings = { resourceRoot: next.resourceRoot };
			return this.settings;
		},
	};
	const application = new LibraryApplication({
		index,
		configuration,
		logger: pino({ enabled: false }),
	});
	const input = { resourceRoot: join(fixture, "next") };
	const save = application.updateSettings(input);
	input.resourceRoot = "/mutated-after-call";
	let stopped = false;
	try {
		await expect(application.startScan()).rejects.toMatchObject({
			code: "SETTINGS_BUSY",
		});
		await expect(
			application.updateSettings({ resourceRoot: root }),
		).rejects.toMatchObject({ code: "SETTINGS_BUSY" });
		expect(preflight).not.toHaveBeenCalled();
		const closing = application.close().then(() => {
			stopped = true;
		});
		await Promise.resolve();
		expect(stopped).toBe(false);
		release();
		await closing;
	} finally {
		release();
		await application.close();
	}
	expect(await save).toEqual({ resourceRoot: join(fixture, "next") });
	expect(index.scannedAt).toBeNull();
	expect(index.revision).toBe(1);
});

test.each(["getFile", "openMedia"] as const)(
	"%s pairs an indexed entry with its original root across a concurrent settings change",
	async (operation) => {
		await writeFile(join(root, "episode.mp4"), "old-root");
		const next = join(fixture, "next");
		await mkdir(next);
		await writeFile(join(next, "episode.mp4"), "different-root-contents");
		await libraryApp.startScan();
		await libraryApp.waitForCompletion();
		const id = createResourceId("file", "episode.mp4");
		const original = ResourceAccess.create;
		let release = () => {};
		let entered = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const opening = new Promise<void>((resolve) => {
			entered = resolve;
		});
		vi.spyOn(ResourceAccess, "create").mockImplementation(async (settings) => {
			entered();
			await gate;
			return original(settings);
		});
		const pending = libraryApp[operation](id);
		await opening;
		try {
			await libraryApp.updateSettings({ resourceRoot: next });
			expect(() => index.getFile(id)).toThrow();
		} finally {
			release();
		}
		const result = await pending;
		expect(result.sizeBytes).toBe(8);
		if ("handle" in result) {
			try {
				expect(await result.handle.readFile("utf8")).toBe("old-root");
			} finally {
				await result.release();
			}
		}
	},
);

test("public library results select fields explicitly rather than exposing future internal data", async () => {
	await writeFile(join(root, "episode.mp4"), "video");
	await libraryApp.startScan();
	await libraryApp.waitForCompletion();
	index.replace(
		[...index.snapshot.entriesById.values()].map((entry) => ({
			...entry,
			privateDiagnostic: fixture,
		})),
	);
	const listing = libraryApp.getDirectory("root");
	const file = await libraryApp.getFile(
		createResourceId("file", "episode.mp4"),
	);
	for (const result of [listing, file]) {
		expect(JSON.stringify(result)).not.toContain("privateDiagnostic");
		expect(JSON.stringify(result)).not.toContain("relativePath");
		expect(JSON.stringify(result)).not.toContain(fixture);
	}
});

test("scheduled scans discover new files, reschedule after completion, and honor interval changes and shutdown", async () => {
	vi.useFakeTimers();
	let settings = { resourceRoot: root, scanIntervalMinutes: 1 };
	const application = new LibraryApplication({
		index,
		configuration: {
			get settings() {
				return settings;
			},
			async update(next) {
				settings = {
					resourceRoot: next.resourceRoot as string,
					scanIntervalMinutes: next.scanIntervalMinutes ?? 60,
				};
				return settings;
			},
		},
		logger: pino({ enabled: false }),
	});
	try {
		await writeFile(join(root, "scheduled.mp4"), "video");
		await vi.advanceTimersByTimeAsync(59999);
		expect(application.state).toBeNull();
		await vi.advanceTimersByTimeAsync(1);
		await application.waitForCompletion();
		expect(index.listChildren("root").map((entry) => entry.name)).toEqual([
			"scheduled.mp4",
		]);
		expect(index.revision).toBe(1);
		await application.updateSettings({
			resourceRoot: root,
			scanIntervalMinutes: 2,
		});
		await vi.advanceTimersByTimeAsync(60000);
		expect(index.revision).toBe(1);
		await vi.advanceTimersByTimeAsync(60000);
		await application.waitForCompletion();
		expect(index.revision).toBe(2);
		await application.updateSettings({
			resourceRoot: root,
			scanIntervalMinutes: 0,
		});
		await vi.advanceTimersByTimeAsync(300000);
		expect(index.revision).toBe(2);
		await application.updateSettings({
			resourceRoot: root,
			scanIntervalMinutes: 1,
		});
		await application.close();
		await vi.advanceTimersByTimeAsync(60000);
		expect(index.revision).toBe(2);
	} finally {
		await application.close();
		vi.useRealTimers();
	}
});

test("long scans have no overlapping timer and the next interval begins at completion", async () => {
	vi.useFakeTimers();
	const application = new LibraryApplication({
		index,
		configuration: {
			settings: { resourceRoot: root, scanIntervalMinutes: 1 },
			async update(next) {
				return next;
			},
		},
		logger: pino({ enabled: false }),
	});
	const create = ResourceAccess.create;
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const opening = vi
		.spyOn(ResourceAccess, "create")
		.mockImplementationOnce(async (settings) => {
			await gate;
			return create(settings);
		});
	try {
		const scan = await application.startScan();
		await vi.advanceTimersByTimeAsync(180000);
		expect(application.state?.id).toBe(scan.id);
		expect(opening).toHaveBeenCalledTimes(1);
		expect(index.revision).toBe(0);
		release();
		await application.waitForCompletion();
		await vi.advanceTimersByTimeAsync(59999);
		expect(index.revision).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		await application.waitForCompletion();
		expect(index.revision).toBe(2);
	} finally {
		release();
		await application.close();
		vi.useRealTimers();
	}
});
