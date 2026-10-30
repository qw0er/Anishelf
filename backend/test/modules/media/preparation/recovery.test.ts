import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { preparationPolicy } from "../../../../src/modules/media/preparation/policy.js";
import { DomainError } from "../../../../src/shared/errors.js";

import {
	barrier,
	cleanup,
	completed,
	fixture,
	required,
	setupTestLifecycle,
	taskId,
	waitForAbort,
} from "./support/preparation-fixture.js";

setupTestLifecycle();

test("restart marks interrupted jobs retryable and cleans incomplete output", async () => {
	let blocked = true;
	const f = await fixture({
		beforeOutput: async (request) => {
			if (blocked) await waitForAbort(request);
		},
	});
	const id = await taskId(f.preparation.create(await f.input()));
	await vi.waitFor(async () =>
		expect((await f.preparation.get(id)).status).toBe("processing"),
	);
	await writeFile(
		join(f.dataDir, "cache", "prepared-media", "orphan.pending"),
		"partial",
	);
	await f.restart();
	const interrupted = await f.preparation.get(id);
	expect(interrupted.status).toBe("failed");
	expect(interrupted.failureReason).toBe("interrupted");
	expect(interrupted.resource).toBeNull();
	await expect(
		readFile(join(f.dataDir, "cache", "prepared-media", "orphan.pending")),
	).rejects.toMatchObject({ code: "ENOENT" });
	blocked = false;
	const { fileId: _fileId, ...retry } = await f.input();
	await f.preparation.retry(id, retry);
	expect((await completed(f, id)).status).toBe("ready");
});

test("an unavailable startup index does not invalidate a reusable completed copy", async () => {
	const f = await fixture();
	const ready = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	const snapshot = vi
		.spyOn(f.library.sources, "hasSnapshot", "get")
		.mockReturnValue(false);
	await f.restart();
	const pendingScan = await f.preparation.get(ready.id);
	expect(pendingScan.status).toBe("ready");
	expect(pendingScan.playbackAvailability).toBe("unknown");
	expect(pendingScan.resource).toBeNull();
	await expect(
		f.preparation.openArtifact(required(ready.artifactId)),
	).rejects.toMatchObject({ code: "PREPARATION_UNAVAILABLE" });
	snapshot.mockRestore();
	const checked = await f.preparation.get(ready.id);
	expect(checked.playbackAvailability).toBe("ready");
	expect(checked.resource?.url).toBe(ready.resource?.url);
});

test("periodic cleanup removes missing sources even after the catalog forgets them", async () => {
	const f = await fixture();
	const ready = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	const path = join(
		f.dataDir,
		"cache",
		"prepared-media",
		`${ready.artifactId}.media`,
	);
	await rm(f.sourcePath);
	await f.library.startScan();
	await f.library.waitForCompletion();
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	await f.restart();
	await vi.advanceTimersByTimeAsync(preparationPolicy.cleanupIntervalMs);
	await expect
		.poll(() => f.database.preparation.get(ready.id)?.state.status)
		.toBe("failed");
	expect(f.database.preparation.get(ready.id)?.state.failureReason).toBe(
		"source-changed",
	);
	expect(
		f.database.preparation.artifact(required(ready.artifactId)),
	).toBeUndefined();
	await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
});

test("periodic cleanup preserves valid copies and retries unavailable roots", async () => {
	const f = await fixture();
	const ready = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	await f.restart();
	await vi.advanceTimersByTimeAsync(preparationPolicy.cleanupIntervalMs);
	expect(
		f.database.preparation.artifact(required(ready.artifactId)),
	).toBeDefined();
	await rm(f.sourcePath);
	const open = vi
		.spyOn(f.library.sources, "openResources")
		.mockRejectedValue(new DomainError("RESOURCE_ROOT_UNAVAILABLE", "Offline"));
	await vi.advanceTimersByTimeAsync(preparationPolicy.cleanupIntervalMs);
	expect(
		f.database.preparation.artifact(required(ready.artifactId)),
	).toBeDefined();
	open.mockRestore();
	await vi.advanceTimersByTimeAsync(preparationPolicy.cleanupIntervalMs);
	await expect
		.poll(() => f.database.preparation.get(ready.id)?.state.status)
		.toBe("failed");
});

test("periodic cleanup retains borrowed bytes until release and stops on close", async () => {
	const f = await fixture();
	const ready = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	await f.restart();
	const handle = await f.preparation.openArtifact(required(ready.artifactId));
	cleanup.push(() => handle.release());
	const path = join(
		f.dataDir,
		"cache",
		"prepared-media",
		`${ready.artifactId}.media`,
	);
	await rm(f.sourcePath);
	await vi.advanceTimersByTimeAsync(preparationPolicy.cleanupIntervalMs);
	await expect
		.poll(() => f.database.preparation.get(ready.id)?.state.status)
		.toBe("failed");
	expect((await readFile(path)).toString()).toBe("0123456789");
	await handle.release();
	await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
	const open = vi.spyOn(f.library.sources, "openResources");
	await f.application.close();
	await vi.advanceTimersByTimeAsync(preparationPolicy.cleanupIntervalMs * 2);
	expect(open).not.toHaveBeenCalled();
});

test("periodic cleanup never overlaps and shutdown waits for an in-flight sweep", async () => {
	const f = await fixture();
	const ready = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	await f.restart();
	const gate = barrier();
	const original = f.library.sources.openResources.bind(f.library.sources);
	const open = vi
		.spyOn(f.library.sources, "openResources")
		.mockImplementation(async (expected) => {
			await gate.promise;
			return original(expected);
		});
	await vi.advanceTimersByTimeAsync(preparationPolicy.cleanupIntervalMs * 3);
	expect(open).toHaveBeenCalledTimes(1);
	let closed = false;
	const closing = f.application.close().then(() => {
		closed = true;
	});
	await vi.advanceTimersByTimeAsync(preparationPolicy.cleanupIntervalMs);
	expect(closed).toBe(false);
	gate.resolve();
	await closing;
	await vi.advanceTimersByTimeAsync(preparationPolicy.cleanupIntervalMs * 2);
	expect(open).toHaveBeenCalledTimes(1);
	expect(
		f.database.preparation.artifact(required(ready.artifactId)),
	).toBeDefined();
});

test("periodic cleanup preserves copies on file access errors and skips an uninitialized catalog", async () => {
	const f = await fixture();
	const ready = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	await f.restart();
	const original = f.library.sources.openResources.bind(f.library.sources);
	const open = vi
		.spyOn(f.library.sources, "openResources")
		.mockImplementation(async (expected) => {
			const resources = await original(expected);
			vi.spyOn(resources, "inspectVideoFile").mockRejectedValue(
				new DomainError("RESOURCE_UNREADABLE", "Denied"),
			);
			return resources;
		});
	await vi.advanceTimersByTimeAsync(preparationPolicy.cleanupIntervalMs);
	expect(open).toHaveBeenCalled();
	expect(
		f.database.preparation.artifact(required(ready.artifactId)),
	).toBeDefined();
	open.mockClear();
	vi.spyOn(f.library.sources, "hasSnapshot", "get").mockReturnValue(false);
	await vi.advanceTimersByTimeAsync(preparationPolicy.cleanupIntervalMs);
	expect(open).not.toHaveBeenCalled();
});
