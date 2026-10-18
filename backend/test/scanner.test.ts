import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
	LibraryScanner,
	type ScanTraversalProgress,
} from "../src/modules/resources/library/infrastructure/scanner.js";
import { ResourceAccess } from "../src/modules/resources/resource-access/infrastructure/access.js";

let fixture: string;
let resources: ResourceAccess;
const scanner = new LibraryScanner(pino({ enabled: false }));
function progress(): ScanTraversalProgress {
	return {
		id: "test",
		visitedCount: 0,
		matchedCount: 0,
		warnings: { count: 0, messages: [] },
	};
}
beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-traversal-"));
	await writeFile(join(fixture, "episode.mp4"), "video");
	resources = await ResourceAccess.create({ resourceRoots: [fixture] });
});
afterEach(async () => {
	vi.restoreAllMocks();
	await rm(fixture, { recursive: true, force: true });
});

test("traversal returns independent candidates for explicitly supplied roots", async () => {
	const firstProgress = progress();
	const first = await scanner.scan(
		resources,
		"first",
		firstProgress,
		new AbortController().signal,
	);
	expect(first?.map((entry) => entry.name)).toEqual(["first", "episode.mp4"]);
	expect(firstProgress.matchedCount).toBe(1);
	const next = join(fixture, "next");
	await mkdir(next);
	const second = await scanner.scan(
		await ResourceAccess.create({ resourceRoots: [next] }),
		"second",
		progress(),
		new AbortController().signal,
	);
	expect(second).toEqual([
		{
			kind: "directory",
			id: "root",
			parentId: null,
			name: "second",
			scopeId: expect.any(String),
			relativePath: "",
		},
	]);
	expect(first).toHaveLength(2);
});

test("an already cancelled traversal returns no candidate and performs no I/O", async () => {
	const controller = new AbortController();
	controller.abort();
	const read = vi.spyOn(resources, "readDirectory");
	expect(
		await scanner.scan(resources, "root", progress(), controller.signal),
	).toBeNull();
	expect(read).not.toHaveBeenCalled();
});

test("cancellation waits for outstanding tasks and discards their candidate", async () => {
	let entered = () => {};
	let release = () => {};
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const inspect = resources.inspectVideoFileWithVersion.bind(resources);
	vi.spyOn(resources, "inspectVideoFileWithVersion").mockImplementation(
		async (path) => {
			entered();
			await gate;
			return inspect(path);
		},
	);
	const controller = new AbortController();
	const running = scanner.scan(
		resources,
		"root",
		progress(),
		controller.signal,
	);
	await started;
	controller.abort();
	release();
	expect(await running).toBeNull();
});
