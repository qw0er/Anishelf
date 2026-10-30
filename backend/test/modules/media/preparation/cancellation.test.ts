import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { PreparedMediaFiles } from "../../../../src/modules/media/preparation/infrastructure/files.js";

import {
	barrier,
	completed,
	fixture,
	required,
	setupTestLifecycle,
	taskId,
	waitForAbort,
} from "./support/preparation-fixture.js";

setupTestLifecycle();

test("queued work shares bounded capacity and cancellation waits for cleanup before retry", async () => {
	let blocked = true;
	const f = await fixture({
		beforeOutput: async (request) => {
			if (blocked) await waitForAbort(request);
		},
		maximumQueuedTasks: 1,
	});
	const input = await f.input();
	const id = await taskId(f.preparation.create(input));
	await vi.waitFor(async () =>
		expect((await f.preparation.get(id)).status).toBe("processing"),
	);
	const next = await taskId(
		f.preparation.create(await f.input({ "copy-audio": "unsupported" })),
	);
	expect((await f.preparation.get(next)).status).toBe("queued");
	await expect(
		f.preparation.create(await f.input({ "copy-video": "unsupported" })),
	).rejects.toMatchObject({ code: "PREPARATION_BUSY" });
	expect((await f.preparation.cancel(next)).status).toBe("cancelled");
	expect((await f.preparation.cancel(id)).status).toBe("cancelled");
	expect((await f.preparation.get(id)).resource).toBeNull();
	blocked = false;
	const { fileId: _fileId, ...retry } = await f.input();
	await f.preparation.retry(id, retry);
	expect((await completed(f, id)).status).toBe("ready");
});

test("slow planning does not block unrelated reads or queued cancellation", async () => {
	const f = await fixture({ beforeOutput: waitForAbort });
	const active = await taskId(f.preparation.create(await f.input()));
	await vi.waitFor(async () =>
		expect((await f.preparation.get(active)).status).toBe("processing"),
	);
	const next = await taskId(
		f.preparation.create(await f.input({ "copy-audio": "unsupported" })),
	);
	const gate = barrier();
	const entered = barrier();
	const original = f.planning.plan.bind(f.planning);
	vi.spyOn(f.planning, "plan").mockImplementationOnce(async (input) => {
		entered.resolve();
		await gate.promise;
		return original(input);
	});
	const slow = f.preparation.create(await f.input());
	try {
		await entered.promise;
		expect((await f.preparation.get(active)).status).toBe("processing");
		expect((await f.preparation.cancel(next)).status).toBe("cancelled");
	} finally {
		gate.resolve();
		await slow;
		await f.preparation.cancel(active);
	}
});

test("a slow ready-file validation does not block cancellation of another task", async () => {
	let block = false;
	const f = await fixture({
		beforeOutput: (request) =>
			block ? waitForAbort(request) : Promise.resolve(),
	});
	const ready = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	block = true;
	const active = await taskId(
		f.preparation.create(await f.input({ "copy-audio": "unsupported" })),
	);
	await vi.waitFor(async () =>
		expect((await f.preparation.get(active)).status).toBe("processing"),
	);
	const gate = barrier();
	const entered = barrier();
	const original = PreparedMediaFiles.prototype.open;
	vi.spyOn(PreparedMediaFiles.prototype, "open").mockImplementationOnce(
		async function (this: PreparedMediaFiles, artifact) {
			entered.resolve();
			await gate.promise;
			return original.call(this, artifact);
		},
	);
	const validation = f.preparation.get(ready.id);
	try {
		await entered.promise;
		expect((await f.preparation.cancel(active)).status).toBe("cancelled");
	} finally {
		gate.resolve();
		await validation;
	}
});

test("cancellation is visible during publication and only finishes after temporary cleanup", async () => {
	const f = await fixture();
	const publication = barrier();
	const entered = barrier();
	const release = barrier();
	const releasing = barrier();
	const originalPublish = PreparedMediaFiles.prototype.publish;
	vi.spyOn(PreparedMediaFiles.prototype, "publish").mockImplementationOnce(
		async function (this: PreparedMediaFiles, id, path, size) {
			entered.resolve();
			await publication.promise;
			return originalPublish.call(this, id, path, size);
		},
	);
	const originalRelease = f.processing.release.bind(f.processing);
	vi.spyOn(f.processing, "release").mockImplementationOnce(async (id) => {
		releasing.resolve();
		await release.promise;
		await originalRelease(id);
	});
	const id = await taskId(f.preparation.create(await f.input()));
	await entered.promise;
	let settled = false;
	const cancelling = f.preparation.cancel(id).then((value) => {
		settled = true;
		return value;
	});
	try {
		await vi.waitFor(async () =>
			expect((await f.preparation.get(id)).status).toBe("cancelling"),
		);
		expect(settled).toBe(false);
		const fresh = await f.input();
		const { fileId: _fileId, ...retry } = fresh;
		await expect(f.preparation.retry(id, retry)).rejects.toMatchObject({
			code: "PREPARATION_BUSY",
		});
		publication.resolve();
		await releasing.promise;
		expect((await f.preparation.get(id)).status).toBe("cancelling");
		expect(settled).toBe(false);
	} finally {
		publication.resolve();
		release.resolve();
	}
	expect((await cancelling).status).toBe("cancelled");
	expect(f.database.preparation.artifacts()).toEqual([]);
	const key = required(f.database.preparation.get(id)).spec.executionPlanId;
	await expect(
		readFile(join(f.dataDir, "cache", "prepared-media", `${key}.media`)),
	).rejects.toMatchObject({ code: "ENOENT" });
	const row = required(f.database.preparation.get(id));
	expect(row.state.status).toBe("cancelled");
	expect(await f.application.get(id)).not.toHaveProperty("resource");
});

test("cleanup failure never acknowledges cancellation and recovery marks it interrupted", async () => {
	const f = await fixture();
	const gate = barrier();
	const entered = barrier();
	vi.spyOn(PreparedMediaFiles.prototype, "publish").mockImplementationOnce(
		async () => {
			entered.resolve();
			await gate.promise;
			throw new Error("Publication stopped");
		},
	);
	const release = vi
		.spyOn(f.processing, "release")
		.mockRejectedValueOnce(new Error("Cleanup failed"));
	const id = await taskId(f.preparation.create(await f.input()));
	await entered.promise;
	const cancelled = f.preparation.cancel(id);
	const rejection = expect(cancelled).rejects.toThrow("Cleanup failed");
	try {
		await vi.waitFor(async () =>
			expect((await f.preparation.get(id)).status).toBe("cancelling"),
		);
	} finally {
		gate.resolve();
	}
	await rejection;
	expect((await f.preparation.get(id)).status).toBe("cancelling");
	await expect(f.preparation.create(await f.input())).rejects.toMatchObject({
		code: "PREPARATION_UNAVAILABLE",
	});
	release.mockRestore();
	await f.restart();
	expect((await f.preparation.get(id)).failureReason).toBe("interrupted");
	const { fileId: _fileId, ...input } = await f.input();
	await f.preparation.retry(id, input);
	expect((await completed(f, id)).status).toBe("ready");
});
