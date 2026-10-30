import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { MediaToolError } from "../../../../src/platform/media/index.js";

import {
	completed,
	fixture,
	headers,
	required,
	setupTestLifecycle,
	taskId,
} from "./support/preparation-fixture.js";

setupTestLifecycle();

test("explicit preparation creates and reuses a copy even for a supported original", async () => {
	const f = await fixture();
	const base = await f.input();
	const input = await f.input(
		Object.fromEntries(base.evidence.map((item) => [item.id, "supported"])),
	);
	const id = await taskId(f.preparation.create(input));
	expect((await completed(f, id)).status).toBe("ready");
	expect(await taskId(f.preparation.create(input))).toBe(id);
	expect(f.processing.start).toHaveBeenCalledTimes(1);
});

test("deduplicates concurrent preparation, publishes ready files, and reuses them after restart", async () => {
	const f = await fixture();
	const input = await f.input();
	const ids = await Promise.all(
		Array.from({ length: 4 }, () => taskId(f.preparation.create(input))),
	);
	expect(new Set(ids).size).toBe(1);
	const task = await completed(f, required(ids[0]));
	expect(task.status).toBe("ready");
	expect(task.progress?.percent).toBe(100);
	expect(JSON.stringify(task)).not.toContain(f.dataDir);
	expect(task).not.toHaveProperty("request");
	expect(f.processing.start).toHaveBeenCalledTimes(1);
	const snapshot = f.database.preparation.get(task.id);
	await f.restart();
	expect((await f.preparation.get(task.id)).status).toBe("ready");
	expect(f.database.preparation.get(task.id)?.spec.settings).toEqual(
		snapshot?.spec.settings,
	);
	expect(f.database.preparation.get(task.id)?.spec).toEqual(snapshot?.spec);
	expect((await f.preparation.get(task.id)).artifactId).toBe(task.artifactId);
	expect(await taskId(f.preparation.create(await f.input()))).toBe(task.id);
	expect(f.processing.start).toHaveBeenCalledTimes(1);
	const file = await f.preparation.openArtifact(required(task.artifactId));
	expect((await file.handle.readFile()).toString()).toBe("0123456789");
	await file.release();
});

test("retry replaces a legacy execution plan without changing the old task", async () => {
	const f = await fixture();
	const plan = f.planning.plan.bind(f.planning);
	vi.spyOn(f.planning, "plan").mockImplementationOnce(async (input) => {
		const planned = structuredClone(await plan(input));
		if (planned.kind !== "processing-required")
			throw new Error("Expected work");
		return {
			...planned,
			identity: { ...planned.identity, executionPlanId: "a".repeat(64) },
			execution: {
				...planned.execution,
				plan: { ...planned.execution.plan, id: "a".repeat(64) },
			},
		};
	});
	const legacy = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	await f.preparation.deleteArtifact(required(legacy.artifactId));
	const original = f.database.preparation.get(legacy.id);
	const { fileId: _fileId, ...input } = await f.input();
	const response = await f.app.inject({
		method: "POST",
		url: `/api/preparations/${legacy.id}/retry`,
		headers,
		payload: input,
	});
	expect(response.statusCode).toBe(200);
	const replacement = response.json();
	expect(replacement.id).not.toBe(legacy.id);
	expect((await completed(f, replacement.id)).status).toBe("ready");
	expect(f.database.preparation.get(legacy.id)).toEqual(original);
	expect(
		f.database.preparation.get(replacement.id)?.spec.executionPlanId,
	).not.toBe(original?.spec.executionPlanId);
	// Repeating the old action reuses the current artifact, without duplicate work.
	expect((await f.preparation.retry(legacy.id, input)).id).toBe(replacement.id);
	expect(f.processing.start).toHaveBeenCalledTimes(2);
	const ready = await f.preparation.get(replacement.id);
	await f.preparation.deleteArtifact(required(ready.artifactId));
	expect((await f.preparation.retry(legacy.id, input)).id).toBe(replacement.id);
	expect((await completed(f, replacement.id)).status).toBe("ready");
	expect(f.processing.start).toHaveBeenCalledTimes(3);
	expect(f.database.preparation.get(legacy.id)).toEqual(original);
});

test("retry does not replace a task when the source version changed", async () => {
	const f = await fixture();
	const task = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	await f.preparation.deleteArtifact(required(task.artifactId));
	await writeFile(f.sourcePath, "changed source");
	const { fileId: _fileId, ...input } = await f.input();
	await expect(f.preparation.retry(task.id, input)).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	expect((await f.preparation.list()).tasks).toHaveLength(1);
	expect(f.processing.start).toHaveBeenCalledTimes(1);
});

test("source replacement invalidates copies while profile edits preserve completed bytes", async () => {
	const f = await fixture();
	const task = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	await writeFile(f.sourcePath, "replaced source with a different version");
	expect((await f.preparation.get(task.id)).failureReason).toBe(
		"source-changed",
	);
	await expect(
		f.preparation.openArtifact(required(task.artifactId)),
	).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
	const fresh = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	required(f.profiles[0]).video.maxHeight = 720;
	await f.restart();
	expect((await f.preparation.get(fresh.id)).status).toBe("ready");
	expect((await f.preparation.get(fresh.id)).artifactId).toBe(fresh.artifactId);
});

test("processing failures remain retryable; missing completed files cannot be served", async () => {
	let fail = true;
	const f = await fixture({
		beforeOutput: async () => {
			if (fail)
				throw new MediaToolError(
					"TOOL_UNAVAILABLE",
					"Unavailable fixture tool",
				);
		},
	});
	const id = await taskId(f.preparation.create(await f.input()));
	const failed = await completed(f, id);
	expect(failed.failureReason).toBe("tool-unavailable");
	fail = false;
	const { fileId: _fileId, ...retry } = await f.input();
	await f.preparation.retry(id, retry);
	const ready = await completed(f, id);
	await rm(
		join(f.dataDir, "cache", "prepared-media", `${ready.artifactId}.media`),
	);
	await f.restart();
	expect((await f.preparation.get(id)).failureReason).toBe("cache-missing");
});

test("publication failure cleans the file without making a ready artifact", async () => {
	const f = await fixture();
	vi.spyOn(f.database.preparation, "publish").mockImplementationOnce(() => {
		throw new Error("Publication database failure");
	});
	const id = await taskId(f.preparation.create(await f.input()));
	expect((await completed(f, id)).status).toBe("failed");
	const key = required(f.database.preparation.get(id)).spec.executionPlanId;
	expect(f.database.preparation.artifacts()).toHaveLength(0);
	await expect(
		readFile(join(f.dataDir, "cache", "prepared-media", `${key}.media`)),
	).rejects.toMatchObject({ code: "ENOENT" });
});

test("worker admission and scheduling never scan the whole task list", async () => {
	const f = await fixture();
	vi.spyOn(f.database.preparation, "list").mockImplementation(() => {
		throw new Error("Unexpected full task scan");
	});
	const id = await taskId(f.preparation.create(await f.input()));
	expect((await completed(f, id)).status).toBe("ready");
});
