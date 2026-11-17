import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ChangeProcessor } from "../../../../src/modules/resources/library/application/change-processor.js";
import { LibraryIndex } from "../../../../src/modules/resources/library/infrastructure/index.js";
import { LibraryScanner } from "../../../../src/modules/resources/library/infrastructure/scanner.js";
import { libraryRuntimePolicy } from "../../../../src/modules/resources/library/policy.js";
import { ResourceRoots } from "../../../../src/modules/resources/resource-access/application/roots.js";
import { ResourceAccess } from "../../../../src/modules/resources/resource-access/infrastructure/access.js";

let fixture: string;
afterEach(async () => {
	vi.restoreAllMocks();
	if (fixture) await rm(fixture, { recursive: true, force: true });
});

test("controlled change batches discover, update and remove only affected subtrees", async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-change-"));
	const media = join(fixture, "media");
	const other = join("other", "keep.mkv");
	const nested = join("series", "nested", "01.mkv");
	const renamed = join("renamed", "nested", "01.mkv");
	await mkdir(join(media, "other"), { recursive: true });
	await writeFile(join(media, other), "keep");
	const roots = new ResourceRoots(libraryRuntimePolicy);
	const root = await roots.resolve({ resourceRoots: [media] });
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
	const unchanged = index.findPath(other, root.scopeId);
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

	await mkdir(join(media, "series", "nested"), { recursive: true });
	await writeFile(join(media, nested), "first");
	await apply(["series", join("series", "nested"), nested]);
	expect(index.findPath(nested, root.scopeId)).toMatchObject({
		sizeBytes: 5,
	});
	await writeFile(join(media, nested), "updated video");
	await apply([nested]);
	expect(index.findPath(nested, root.scopeId)).toMatchObject({
		sizeBytes: 13,
	});
	await rename(join(media, "series"), join(media, "renamed"));
	await apply(["series", "renamed"]);
	expect(index.findPath("series", root.scopeId)).toBeUndefined();
	expect(index.findPath(renamed, root.scopeId)?.kind).toBe("file");
	await rm(join(media, "renamed"), { recursive: true });
	await apply(["renamed"]);
	expect(index.findPath(renamed, root.scopeId)).toBeUndefined();

	expect(index.findPath(other, root.scopeId)).toEqual(unchanged);
	expect(read.mock.calls.some(([path]) => path === "other")).toBe(false);
	expect(inspect.mock.calls.some(([path]) => path === other)).toBe(false);
});
