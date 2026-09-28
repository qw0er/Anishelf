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
import { DomainError } from "../src/errors.js";
import { createResourceId, LibraryIndex } from "../src/library/index.js";
import { LibraryScanner } from "../src/library/scanner.js";
import { ResourceAccess } from "../src/resources/access.js";

let fixture: string;
let root: string;
let index: LibraryIndex;
let scanner: LibraryScanner;
beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-scan-"));
	root = join(fixture, "media");
	await mkdir(root);
	index = new LibraryIndex();
	scanner = new LibraryScanner({
		index,
		settings: () => ({ resourceRoot: root }),
		logger: pino({ enabled: false }),
	});
});
afterEach(async () => {
	await scanner.close();
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
	expect(scanner.state).toBeNull();
	expect(scanner.start().status).toBe("running");
	expect(await scanner.waitForCompletion()).toMatchObject({
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
	scanner.start();
	expect(await scanner.waitForCompletion()).toMatchObject({
		status: "completed",
		matchedCount: 0,
	});
	expect(index.revision).toBe(1);
	expect(index.listChildren("root")).toEqual([]);
});

test("reuses the active scan and replaces additions and removals without duplicate paths", async () => {
	await writeFile(join(root, "kept.mp4"), "video");
	await writeFile(join(root, "old.mp4"), "video");
	const first = scanner.start();
	expect(scanner.start().id).toBe(first.id);
	await scanner.waitForCompletion();
	await rm(join(root, "old.mp4"));
	await writeFile(join(root, "new.mp4"), "video");
	const second = scanner.start();
	expect(second.id).not.toBe(first.id);
	expect(index.getFile(createResourceId("file", "old.mp4"))).toBeDefined();
	await scanner.waitForCompletion();
	expect(index.revision).toBe(2);
	expect(index.listChildren("root").map((entry) => entry.name)).toEqual([
		"kept.mp4",
		"new.mp4",
	]);
});

test("a missing root fails the rescan, keeps the old snapshot, and can recover", async () => {
	await writeFile(join(root, "kept.mp4"), "video");
	scanner.start();
	await scanner.waitForCompletion();
	const previous = index.snapshot;
	await rename(root, join(fixture, "backup"));
	scanner.start();
	expect(await scanner.waitForCompletion()).toMatchObject({
		status: "failed",
		error: { code: "RESOURCE_ROOT_UNAVAILABLE" },
	});
	expect(index.snapshot).toEqual(previous);
	expect(JSON.stringify(scanner.state)).not.toContain(fixture);
	await rename(join(fixture, "backup"), root);
	scanner.start();
	expect((await scanner.waitForCompletion())?.status).toBe("completed");
});

test("child access failures produce a partial snapshot and safe warning summaries", async () => {
	await mkdir(join(root, "blocked"));
	await writeFile(join(root, "blocked", "hidden.mp4"), "video");
	await writeFile(join(root, "removed.mp4"), "video");
	await writeFile(join(root, "good.mp4"), "video");
	const resources = await ResourceAccess.create({ resourceRoot: root });
	const readDirectory = resources.readDirectory.bind(resources);
	const inspectFile = resources.inspectFile.bind(resources);
	vi.spyOn(ResourceAccess, "create").mockResolvedValue(resources);
	vi.spyOn(resources, "readDirectory").mockImplementation(async (path = "") => {
		if (path === "blocked")
			throw new DomainError("RESOURCE_UNREADABLE", `secret ${fixture}`);
		return readDirectory(path);
	});
	vi.spyOn(resources, "inspectFile").mockImplementation(async (path) => {
		if (path === "removed.mp4")
			throw new DomainError("RESOURCE_MISSING", `secret ${fixture}`);
		return inspectFile(path);
	});
	scanner.start();
	expect(await scanner.waitForCompletion()).toMatchObject({
		status: "completed",
		matchedCount: 1,
		warnings: { count: 2 },
	});
	expect(index.listChildren("root").map((entry) => entry.name)).toEqual([
		"good.mp4",
	]);
	expect(JSON.stringify(scanner.state)).not.toContain("secret");
	expect(JSON.stringify(scanner.state)).not.toContain(fixture);
});

test("losing the root during traversal fails instead of publishing a partial result", async () => {
	await writeFile(join(root, "episode.mp4"), "video");
	const resources = await ResourceAccess.create({ resourceRoot: root });
	const inspectFile = resources.inspectFile.bind(resources);
	vi.spyOn(ResourceAccess, "create").mockResolvedValue(resources);
	vi.spyOn(resources, "inspectFile").mockImplementation(async (path) => {
		const result = await inspectFile(path);
		await rename(root, join(fixture, "moved"));
		return result;
	});
	scanner.start();
	expect(await scanner.waitForCompletion()).toMatchObject({
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
	const inspectFile = resources.inspectFile.bind(resources);
	let active = 0;
	let maximum = 0;
	vi.spyOn(resources, "inspectFile").mockImplementation(async (path) => {
		active++;
		maximum = Math.max(maximum, active);
		try {
			return await inspectFile(path);
		} finally {
			active--;
		}
	});
	scanner.start();
	expect((await scanner.waitForCompletion())?.status).toBe("completed");
	expect(maximum).toBe(8);
	expect(active).toBe(0);
	expect(index.listChildren("root")).toHaveLength(20);
});

test("cancellation discards the candidate and allows another scan", async () => {
	await writeFile(join(root, "episode.mp4"), "video");
	scanner.start();
	await scanner.cancel();
	expect(scanner.state?.status).toBe("cancelled");
	expect(index.revision).toBe(0);
	scanner.start();
	expect((await scanner.waitForCompletion())?.status).toBe("completed");
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
	const inspectFile = resources.inspectFile.bind(resources);
	vi.spyOn(resources, "inspectFile").mockImplementation(async (path) => {
		entered();
		await pending;
		return inspectFile(path);
	});
	scanner.start();
	await started;
	const closed = scanner.close();
	release();
	await closed;
	expect(scanner.state?.status).toBe("cancelled");
	expect(index.revision).toBe(0);
	expect(() => scanner.start()).toThrow();
});

test("settings changes during a scan prevent publication and the next scan uses the new root", async () => {
	await writeFile(join(root, "episode.mp4"), "video");
	const nextRoot = join(fixture, "next");
	await mkdir(nextRoot);
	const resources = await ResourceAccess.create({ resourceRoot: root });
	const inspectFile = resources.inspectFile.bind(resources);
	const create = vi
		.spyOn(ResourceAccess, "create")
		.mockResolvedValue(resources);
	vi.spyOn(resources, "inspectFile").mockImplementation(async (path) => {
		const result = await inspectFile(path);
		root = nextRoot;
		return result;
	});
	scanner.start();
	expect((await scanner.waitForCompletion())?.status).toBe("failed");
	expect(index.revision).toBe(0);
	create.mockRestore();
	scanner.start();
	expect((await scanner.waitForCompletion())?.status).toBe("completed");
	expect(index.getDirectory("root").name).toBe("next");
});

test("returned scan state cannot mutate internal progress or warnings", async () => {
	const state = scanner.start();
	state.warnings.count = 999;
	(state.warnings.messages as string[]).push("changed");
	expect(scanner.state?.warnings).toEqual({ count: 0, messages: [] });
	await scanner.waitForCompletion();
});
