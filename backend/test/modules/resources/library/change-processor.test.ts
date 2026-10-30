import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ChangeProcessor } from "../../../../src/modules/resources/library/application/change-processor.js";
import { LibraryIndex } from "../../../../src/modules/resources/library/infrastructure/index.js";
import { LibraryScanner } from "../../../../src/modules/resources/library/infrastructure/scanner.js";
import { libraryRuntimePolicy } from "../../../../src/modules/resources/library/policy.js";
import { ResourceRoots } from "../../../../src/modules/resources/resource-access/application/roots.js";
import { ResourceAccess } from "../../../../src/modules/resources/resource-access/infrastructure/access.js";

vi.mock("node:fs/promises", async () => {
	const { memoryFs } = await import("../../../support/memory-filesystem.js");
	return memoryFs.promises;
});
afterEach(() => vi.restoreAllMocks());

test("controlled change batches discover, update and remove only affected subtrees", async () => {
	await mkdir("/media/other", { recursive: true });
	await writeFile("/media/other/keep.mkv", "keep");
	const roots = new ResourceRoots(libraryRuntimePolicy);
	const root = await roots.resolve({ resourceRoots: ["/media"] });
	const resources = await roots.open(root);
	const index = new LibraryIndex();
	const scan = new LibraryScanner(pino({ enabled: false }));
	const signal = new AbortController().signal;
	const entries = await scan.scan(
		resources,
		root.name,
		{
			id: "baseline",
			visitedCount: 0,
			matchedCount: 0,
			warnings: { count: 0, messages: [] },
		},
		signal,
	);
	if (!entries) throw new Error("Missing baseline scan.");
	index.replace(entries);
	const unchanged = index.findPath("other/keep.mkv", root.scopeId);
	expect(unchanged?.kind).toBe("file");
	const read = vi.spyOn(ResourceAccess.prototype, "readDirectory");
	const inspect = vi.spyOn(
		ResourceAccess.prototype,
		"inspectVideoFileWithVersion",
	);
	const processor = new ChangeProcessor({
		roots,
		index,
		policy: libraryRuntimePolicy,
	});
	const apply = async (paths: string[]) => {
		const patch = await processor.read(root, paths, signal);
		index.apply(patch.upserts, patch.removals);
	};

	await mkdir("/media/series/nested", { recursive: true });
	await writeFile("/media/series/nested/01.mkv", "first");
	await apply(["series", "series/nested", "series/nested/01.mkv"]);
	expect(index.findPath("series/nested/01.mkv", root.scopeId)).toMatchObject({
		sizeBytes: 5,
	});
	await writeFile("/media/series/nested/01.mkv", "updated video");
	await apply(["series/nested/01.mkv"]);
	expect(index.findPath("series/nested/01.mkv", root.scopeId)).toMatchObject({
		sizeBytes: 13,
	});
	await rename("/media/series", "/media/renamed");
	await apply(["series", "renamed"]);
	expect(index.findPath("series", root.scopeId)).toBeUndefined();
	expect(index.findPath("renamed/nested/01.mkv", root.scopeId)?.kind).toBe(
		"file",
	);
	await rm("/media/renamed", { recursive: true });
	await apply(["renamed"]);
	expect(index.findPath("renamed/nested/01.mkv", root.scopeId)).toBeUndefined();

	expect(index.findPath("other/keep.mkv", root.scopeId)).toEqual(unchanged);
	expect(read.mock.calls.some(([path]) => path === "other")).toBe(false);
	expect(inspect.mock.calls.some(([path]) => path === "other/keep.mkv")).toBe(
		false,
	);
});
