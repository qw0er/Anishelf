import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { createResourceId } from "../src/modules/resources/library/domain/model.js";
import { LibraryIndex } from "../src/modules/resources/library/infrastructure/index.js";
import { LibraryScanner } from "../src/modules/resources/library/infrastructure/scanner.js";
import { libraryRuntimePolicy } from "../src/modules/resources/library/policy.js";
import { resourceRootId } from "../src/modules/resources/resource-access/domain/identity.js";
import { ResourceAccess } from "../src/modules/resources/resource-access/infrastructure/access.js";
import { createLibraryModule } from "./support/library.js";
import { updateResourceSettings } from "./support/settings.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
	vi.restoreAllMocks();
});
async function fixture() {
	const base = await mkdtemp(join(tmpdir(), "anishelf-monitor-"));
	cleanup.push(() => rm(base, { recursive: true, force: true }));
	const root = join(base, "media");
	await mkdir(root);
	const index = new LibraryIndex();
	const policy = {
		...libraryRuntimePolicy,
		library: { ...libraryRuntimePolicy.library },
	};
	policy.library.changeDebounceMs = 20;
	policy.library.writeStabilityMs = 100;
	policy.library.monitorRetryMs = 100;
	let settings = { resourceRoots: [root] };
	const library = createLibraryModule({
		index,
		policy,
		logger: pino({ enabled: false }),
		configuration: {
			get settings() {
				return settings;
			},
			async update(next) {
				settings = { resourceRoots: next.resourceRoots };
				return settings;
			},
		},
	});
	cleanup.push(() => library.close());
	return {
		base,
		root,
		index,
		library,
		get scopeId() {
			return index.getDirectory("root").scopeId ?? resourceRootId(root);
		},
	};
}
const fileId = (path: string, scopeId: string) =>
	createResourceId("file", path, scopeId);

test("native monitoring updates only changed paths, preserves unrelated directories, and never performs another full scan", async () => {
	const f = await fixture();
	await mkdir(join(f.root, "other"));
	await writeFile(join(f.root, "other/keep.mkv"), "keep");
	const scan = vi.spyOn(LibraryScanner.prototype, "scan");
	await f.library.startScan();
	await f.library.waitForCompletion();
	const read = vi.spyOn(ResourceAccess.prototype, "readDirectory");
	const inspect = vi.spyOn(
		ResourceAccess.prototype,
		"inspectVideoFileWithVersion",
	);
	await mkdir(join(f.root, "series/nested"), { recursive: true });
	await writeFile(join(f.root, "series/nested/01.mkv"), "first");
	await expect
		.poll(() => f.index.findPath("series/nested/01.mkv", f.scopeId)?.kind)
		.toBe("file");
	await writeFile(join(f.root, "series/nested/01.mkv"), "updated video");
	await expect
		.poll(
			() =>
				f.index.getFile(fileId("series/nested/01.mkv", f.scopeId)).sizeBytes,
		)
		.toBe(13);
	await rename(join(f.root, "series"), join(f.root, "renamed"));
	await expect
		.poll(() => f.index.findPath("renamed/nested/01.mkv", f.scopeId)?.kind)
		.toBe("file");
	await expect
		.poll(() => f.index.findPath("series", f.scopeId))
		.toBeUndefined();
	await rm(join(f.root, "renamed"), { recursive: true });
	await expect
		.poll(() => f.index.findPath("renamed/nested/01.mkv", f.scopeId))
		.toBeUndefined();
	expect(f.index.getFile(fileId("other/keep.mkv", f.scopeId)).sizeBytes).toBe(
		4,
	);
	expect(read.mock.calls.some(([path]) => path === "other")).toBe(false);
	expect(inspect.mock.calls.some(([path]) => path === "other/keep.mkv")).toBe(
		false,
	);
	expect(scan).toHaveBeenCalledTimes(1);
	expect((await f.library.getStatus()).monitor?.status).toBe("watching");
});

test("events during a baseline scan are retained and applied after publication", async () => {
	const f = await fixture();
	await writeFile(join(f.root, "initial.mkv"), "initial");
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered = () => {};
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const original = ResourceAccess.prototype.inspectVideoFileWithVersion;
	vi.spyOn(
		ResourceAccess.prototype,
		"inspectVideoFileWithVersion",
	).mockImplementationOnce(async function (this: ResourceAccess, path) {
		entered();
		await gate;
		return original.call(this, path);
	});
	try {
		await f.library.startScan();
		await started;
		await writeFile(join(f.root, "late.mkv"), "late");
		await new Promise((resolve) => setTimeout(resolve, 250));
		release();
		await f.library.waitForCompletion();
		await expect
			.poll(() => f.index.findPath("late.mkv", f.scopeId)?.kind)
			.toBe("file");
	} finally {
		release();
	}
});

test("losing the root retains the snapshot, reports degradation, and reconciles after recovery", async () => {
	const f = await fixture();
	await writeFile(join(f.root, "keep.mkv"), "keep");
	await f.library.startScan();
	await f.library.waitForCompletion();
	const away = join(f.base, "away");
	await rename(f.root, away);
	await expect
		.poll(async () => (await f.library.getStatus()).monitor?.status)
		.toBe("degraded");
	expect(f.index.findPath("keep.mkv", f.scopeId)?.kind).toBe("file");
	await writeFile(join(away, "new.mkv"), "new");
	await rename(away, f.root);
	await expect
		.poll(() => f.index.findPath("new.mkv", f.scopeId)?.kind, { timeout: 5000 })
		.toBe("file");
	await expect
		.poll(async () => (await f.library.getStatus()).monitor?.status)
		.toBe("watching");
});

test("switching roots drops old queued events and closes monitoring on shutdown", async () => {
	const f = await fixture();
	await f.library.startScan();
	await f.library.waitForCompletion();
	await writeFile(join(f.root, "old.mkv"), "old");
	const next = join(f.base, "next");
	await mkdir(next);
	await writeFile(join(next, "new.mkv"), "new");
	await updateResourceSettings(f.library, { resourceRoots: [next] });
	await f.library.waitForCompletion();
	await expect
		.poll(() => f.index.findPath("new.mkv", f.scopeId)?.kind)
		.toBe("file");
	await f.library.close();
	const revision = f.index.revision;
	await writeFile(join(next, "closed.mkv"), "closed");
	await new Promise((resolve) => setTimeout(resolve, 250));
	expect(f.index.revision).toBe(revision);
	expect(f.index.findPath("old.mkv", f.scopeId)).toBeUndefined();
});

test("unreadable changed resources retain their prior entry until recovery can reconcile them", async () => {
	const f = await fixture();
	await writeFile(join(f.root, "keep.mkv"), "original");
	await f.library.startScan();
	await f.library.waitForCompletion();
	const original = ResourceAccess.prototype.inspectVideoFileWithVersion;
	const inspect = vi
		.spyOn(ResourceAccess.prototype, "inspectVideoFileWithVersion")
		.mockImplementation(async function (this: ResourceAccess, path) {
			if (path === "keep.mkv") throw new Error("Unreadable file");
			return original.call(this, path);
		});
	await writeFile(join(f.root, "keep.mkv"), "new content");
	await expect
		.poll(async () => (await f.library.getStatus()).monitor?.status)
		.toBe("degraded");
	expect(f.index.getFile(fileId("keep.mkv", f.scopeId)).sizeBytes).toBe(8);
	inspect.mockRestore();
	await expect
		.poll(() => f.index.getFile(fileId("keep.mkv", f.scopeId)).sizeBytes, {
			timeout: 5000,
		})
		.toBe(11);
});

test("multiple native monitors isolate equal paths and keep healthy roots updating during recovery", async () => {
	const f = await fixture();
	const other = join(f.base, "other-root");
	await mkdir(other);
	await writeFile(join(f.root, "same.mkv"), "first");
	await writeFile(join(other, "same.mkv"), "second");
	await updateResourceSettings(f.library, { resourceRoots: [f.root, other] });
	await f.library.waitForCompletion();
	const firstScope = resourceRootId(f.root);
	const secondScope = resourceRootId(other);
	expect(f.index.getFile(fileId("same.mkv", firstScope)).sizeBytes).toBe(5);
	expect(f.index.getFile(fileId("same.mkv", secondScope)).sizeBytes).toBe(6);
	const scan = vi.spyOn(LibraryScanner.prototype, "scan");
	await writeFile(join(f.root, "same.mkv"), "first update");
	await writeFile(join(other, "same.mkv"), "second update");
	await expect
		.poll(() => f.index.getFile(fileId("same.mkv", firstScope)).sizeBytes)
		.toBe(12);
	await expect
		.poll(() => f.index.getFile(fileId("same.mkv", secondScope)).sizeBytes)
		.toBe(13);
	expect(scan).not.toHaveBeenCalled();
	const away = join(f.base, "away");
	await rename(f.root, away);
	await expect
		.poll(async () => (await f.library.getStatus()).monitor?.status)
		.toBe("degraded");
	expect((await f.library.getStatus()).ready).toBe(true);
	await writeFile(join(other, "healthy.mkv"), "healthy");
	await expect
		.poll(() => f.index.findPath("healthy.mkv", secondScope)?.kind)
		.toBe("file");
	expect(f.index.getFile(fileId("same.mkv", firstScope)).sizeBytes).toBe(12);
	await writeFile(join(away, "restored.mkv"), "restored");
	await rename(away, f.root);
	await expect
		.poll(() => f.index.findPath("restored.mkv", firstScope)?.kind, {
			timeout: 5000,
		})
		.toBe("file");
	expect(
		scan.mock.calls.every(([resources]) => resources.scopeId === firstScope),
	).toBe(true);
	await expect
		.poll(async () => (await f.library.getStatus()).monitor?.status)
		.toBe("watching");
});
