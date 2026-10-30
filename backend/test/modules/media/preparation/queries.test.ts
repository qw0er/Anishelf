import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, vi } from "vitest";
import { PreparedMediaFiles } from "../../../../src/modules/media/preparation/infrastructure/files.js";
import { updateResourceSettings } from "../../../support/settings.js";

import {
	completed,
	fixture,
	headers,
	required,
	setupTestLifecycle,
	taskId,
} from "./support/preparation-fixture.js";

setupTestLifecycle();

test("file-filtered task lookup finds an older copy outside the global recent-task limit", async () => {
	const f = await fixture({ listLimit: 1 });
	const result = await f.preparation.create(await f.input());
	if (result.kind !== "task") throw new Error("Expected task");
	await vi.waitFor(async () =>
		expect((await f.preparation.get(result.task.id)).status).toBe("ready"),
	);
	const original = required(f.database.preparation.get(result.task.id));
	f.database.preparation.insert({
		...original,
		id: randomUUID(),
		spec: {
			...original.spec,
			source: {
				...original.spec.source,
				fileId: "another-file",
				relativePath: "another.mkv",
			},
			executionPlanId: "f".repeat(64),
		},
		state: {
			status: "failed",
			failureReason: "processing-failed",
			progress: null,
			updatedAtMs: original.state.updatedAtMs + 1,
		},
		createdAtMs: original.createdAtMs + 1,
	});
	const recent = await f.preparation.list();
	expect(recent.tasks[0]?.fileId).toBe("another-file");
	const filtered = await f.app.inject({
		method: "GET",
		url: `/api/preparations?fileId=${encodeURIComponent(original.spec.source.fileId)}`,
		headers,
	});
	expect(filtered.statusCode).toBe(200);
	expect(filtered.json().tasks[0]).toMatchObject({
		id: original.id,
		status: "ready",
		playbackAvailability: "ready",
	});
	const batch = await f.app.inject({
		method: "POST",
		url: "/api/preparations/summaries",
		headers,
		payload: { fileIds: [original.spec.source.fileId] },
	});
	expect(batch.json().files[0].versions).toEqual([
		{
			sourceVersion: original.spec.source.sourceVersion,
			publishedCopies: 1,
			pendingTasks: 0,
		},
	]);
	const invalid = await f.app.inject({
		method: "GET",
		url: "/api/preparations?fileId=bad/path",
		headers,
	});
	expect(invalid.statusCode).toBe(400);
});

test("query telemetry is projected and immutable specifications are not rewritten by progress", async () => {
	const f = await fixture();
	const id = await taskId(f.preparation.create(await f.input()));
	const ready = await completed(f, id);
	expect(ready.progress).toEqual({ percent: 100, mediaTimeMs: 2000, speed: 1 });
	const task = required(f.database.preparation.get(id));
	expect(Object.isFrozen(task.spec.settings)).toBe(true);
	expect(task.spec.settings.plan).not.toHaveProperty("id");
	expect(task.spec.settings).not.toHaveProperty("request");
	expect(task.spec.settings).not.toHaveProperty("identity");
	expect(task.spec.settings).not.toHaveProperty("sourceVersion");
	expect(task.state.progress).toHaveProperty("outputBytes", 10);
	const raw = new Database(join(f.dataDir, "anishelf.sqlite"));
	try {
		expect(raw.pragma("foreign_key_check")).toEqual([]);
	} finally {
		raw.close();
	}
});

test("directory summaries include old publications without validating source or artifact bytes", async () => {
	const f = await fixture({ listLimit: 1 });
	const id = await taskId(f.preparation.create(await f.input()));
	const ready = await completed(f, id);
	const fileId = ready.fileId;
	const resolve = vi.spyOn(f.library.sources, "resolveSource");
	const revalidate = vi.spyOn(f.library.sources, "revalidateSource");
	const artifact = vi.spyOn(PreparedMediaFiles.prototype, "open");
	const response = await f.app.inject({
		method: "POST",
		url: "/api/preparations/summaries",
		headers,
		payload: { fileIds: [fileId] },
	});
	expect(response.statusCode).toBe(200);
	expect(response.json()).toEqual({
		files: [
			{
				fileId,
				versions: [
					{
						sourceVersion: ready.sourceVersion,
						publishedCopies: 1,
						pendingTasks: 0,
					},
				],
			},
		],
	});
	expect(resolve).not.toHaveBeenCalled();
	expect(revalidate).not.toHaveBeenCalled();
	expect(artifact).not.toHaveBeenCalled();
	await rm(
		join(f.dataDir, "cache", "prepared-media", `${ready.artifactId}.media`),
	);
	const summary = await f.app.inject({
		url: "/api/preparations?summary=true",
		headers,
	});
	expect(summary.statusCode).toBe(200);
	expect(summary.json().tasks[0]).toMatchObject({
		id,
		status: "ready",
		resource: null,
		playbackAvailability: "unknown",
		artifactId: ready.artifactId,
	});
	expect(artifact).not.toHaveBeenCalled();
	expect((await f.preparation.get(id)).failureReason).toBe("cache-missing");
});

test("summaries separate source versions and filter the current profile and root", async () => {
	const f = await fixture();
	const ready = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	const task = required(f.database.preparation.get(ready.id));
	f.database.preparation.insert({
		...task,
		id: randomUUID(),
		spec: {
			...task.spec,
			executionPlanId: "b".repeat(64),
			source: { ...task.spec.source, sourceVersion: "b".repeat(64) },
		},
		state: {
			status: "processing",
			progress: null,
			failureReason: null,
			updatedAtMs: Date.now(),
		},
	});
	const result = await f.application.summaries([ready.fileId]);
	expect(result.files[0]?.versions).toEqual(
		expect.arrayContaining([
			{
				sourceVersion: ready.sourceVersion,
				publishedCopies: 1,
				pendingTasks: 0,
			},
			{ sourceVersion: "b".repeat(64), publishedCopies: 0, pendingTasks: 1 },
		]),
	);
	const profile = required(
		f.profiles.find((profile) => profile.id === task.profileId),
	);
	profile.copyCompatibleStreams = !profile.copyCompatibleStreams;
	expect(
		(await f.application.summaries([ready.fileId])).files[0]?.versions,
	).toEqual([
		{ sourceVersion: ready.sourceVersion, publishedCopies: 1, pendingTasks: 0 },
	]);
	const otherRoot = join(f.dataDir, "other-root");
	await mkdir(otherRoot, { recursive: true });
	await updateResourceSettings(f.library, { resourceRoots: [otherRoot] });
	expect(
		(await f.application.summaries([ready.fileId])).files[0]?.versions,
	).toEqual([]);
});
