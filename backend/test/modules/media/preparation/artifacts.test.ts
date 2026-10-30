import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, vi } from "vitest";
import { MediaAssetsApplication } from "../../../../src/modules/media/media-assets/application.js";
import {
	InvalidPreparedMediaError,
	PreparedMediaFiles,
} from "../../../../src/modules/media/preparation/infrastructure/files.js";

import {
	completed,
	fixture,
	logger,
	required,
	setupTestLifecycle,
	taskId,
} from "./support/preparation-fixture.js";

setupTestLifecycle();

test("pins borrowed artifacts and deleting cache preserves original media and durable progress", async () => {
	const f = await fixture();
	const input = await f.input();
	const session = await f.playback.open(input.fileId);
	await f.playback.save({
		token: session.token,
		generation: session.progress.generation,
		sourceVersion: session.sourceVersion,
		sequence: 1,
		positionMs: 1000,
		durationMs: 2000,
	});
	const task = await completed(f, await taskId(f.preparation.create(input)));
	const file = await f.preparation.openArtifact(required(task.artifactId));
	await expect(
		f.preparation.deleteArtifact(required(task.artifactId)),
	).rejects.toMatchObject({ code: "PREPARATION_BUSY" });
	await file.release();
	await file.release();
	await f.preparation.deleteArtifact(required(task.artifactId));
	expect((await f.preparation.get(task.id)).failureReason).toBe(
		"cache-deleted",
	);
	await expect(
		f.preparation.openArtifact(required(task.artifactId)),
	).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
	expect((await readFile(f.sourcePath)).toString()).toBe("source");
	expect(f.database.playback.get(session.progress.sourceId)?.positionMs).toBe(
		1000,
	);
	const { fileId: _fileId, ...retry } = await f.input();
	await f.preparation.retry(task.id, retry);
	expect((await completed(f, task.id)).status).toBe("ready");
});

test.each([
	[10, undefined, "cache-full"],
	[undefined, Number.MAX_SAFE_INTEGER, "storage-full"],
] as const)(
	"storage limits fail safely (%s, %s)",
	async (maximumCacheBytes, minimumFreeBytes, reason) => {
		const f = await fixture({
			...(maximumCacheBytes === undefined ? {} : { maximumCacheBytes }),
			...(minimumFreeBytes === undefined ? {} : { minimumFreeBytes }),
		});
		const task = await completed(
			f,
			await taskId(f.preparation.create(await f.input())),
		);
		expect(task.status).toBe("failed");
		expect(task.failureReason).toBe(reason);
		expect(task.resource).toBeNull();
		expect(f.database.preparation.artifacts()).toHaveLength(0);
	},
);

test("invalidated borrowed bytes still count against the cache budget", async () => {
	const f = await fixture({ maximumCacheBytes: 20 });
	const first = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	const borrowed = await f.preparation.openArtifact(required(first.artifactId));
	await writeFile(f.sourcePath, "replaced source");
	expect((await f.preparation.get(first.id)).failureReason).toBe(
		"source-changed",
	);
	const secondId = await taskId(f.preparation.create(await f.input()));
	expect((await completed(f, secondId)).failureReason).toBe("cache-full");
	expect(vi.mocked(f.processing.start).mock.calls[1]?.[0].maximumBytes).toBe(
		10,
	);
	await borrowed.release();
	const { fileId: _fileId, ...retry } = await f.input();
	await f.preparation.retry(secondId, retry);
	expect((await completed(f, secondId)).status).toBe("ready");
});

test("invalidated borrowers prevent replacing the same artifact until all handles release", async () => {
	const f = await fixture();
	const ready = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	const one = await f.preparation.openArtifact(required(ready.artifactId));
	const two = await f.preparation.openArtifact(required(ready.artifactId));
	vi.spyOn(PreparedMediaFiles.prototype, "open").mockRejectedValueOnce(
		new InvalidPreparedMediaError(),
	);
	expect((await f.preparation.get(ready.id)).failureReason).toBe(
		"cache-missing",
	);
	const { fileId: _fileId, ...input } = await f.input();
	await expect(f.preparation.retry(ready.id, input)).rejects.toMatchObject({
		code: "PREPARATION_BUSY",
	});
	await one.release();
	await one.release();
	await expect(f.preparation.retry(ready.id, input)).rejects.toMatchObject({
		code: "PREPARATION_BUSY",
	});
	await two.release();
	await f.preparation.retry(ready.id, input);
	expect((await completed(f, ready.id)).status).toBe("ready");
});

test("new preparation attempts read the updated cache budget", async () => {
	let budget = 10;
	const f = await fixture({ cacheBudget: () => budget });
	const id = await taskId(f.preparation.create(await f.input()));
	expect((await completed(f, id)).failureReason).toBe("cache-full");
	budget = 100;
	const { fileId: _fileId, ...retry } = await f.input();
	await f.preparation.retry(id, retry);
	expect((await completed(f, id)).status).toBe("ready");
	expect(vi.mocked(f.processing.start).mock.calls[1]?.[0].maximumBytes).toBe(
		100,
	);
});

test("published output inspection survives restart and existing cache entries are inspected once", async () => {
	const f = await fixture();
	const task = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	const id = required(task.artifactId);
	expect(f.database.preparation.artifact(id)?.info?.streams[0]?.codec).toBe(
		"h264",
	);
	const raw = new Database(join(f.dataDir, "anishelf.sqlite"));
	try {
		raw
			.prepare("UPDATE prepared_artifacts SET info = NULL WHERE id = ?")
			.run(id);
	} finally {
		raw.close();
	}
	f.probe.mockClear();
	await f.restart();
	expect((await f.preparation.get(task.id)).status).toBe("ready");
	expect(f.probe).toHaveBeenCalledTimes(1);
	await f.preparation.get(task.id);
	expect(f.probe).toHaveBeenCalledTimes(1);
	expect(f.database.preparation.artifact(id)?.info?.streams[0]?.codec).toBe(
		"h264",
	);
});

test("asset read model uses stored output facts independently of profiles and excludes private inspection fields", async () => {
	const f = await fixture();
	const task = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	const artifact = required(
		f.database.preparation.artifact(required(task.artifactId)),
	);
	const info = required(artifact.info);
	info.tags = { privatePath: "/private/server/media" };
	f.database.preparation.saveArtifactInfo(artifact.id, info);
	const assets = new MediaAssetsApplication({
		inspection: f.inspection,
		preparation: f.application,
		sources: f.library.sources,
		logger,
	});
	const initial = await assets.list(task.fileId, task.sourceVersion);
	const copy = required(
		initial.assets.find((asset) => asset.kind === "prepared"),
	);
	expect(copy.video?.height).toBe(90);
	expect(copy.audioTracks[0]?.sourceStreamIndex).toBe(1);
	expect(JSON.stringify(initial)).not.toContain("/private/server/media");
	expect(copy).not.toHaveProperty("taskId");
	required(f.profiles[0]).video.maxHeight = 18;
	required(copy.video).height = 999;
	const next = required(
		(await assets.list(task.fileId, task.sourceVersion)).assets.find(
			(asset) => asset.kind === "prepared",
		),
	);
	expect(next.video?.height).toBe(90);
	expect(next.revision).toBe(copy.revision);
});
