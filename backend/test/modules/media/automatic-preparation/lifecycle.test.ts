import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test, vi } from "vitest";
import { AutomaticPreparationApplication } from "../../../../src/modules/media/automatic-preparation/application.js";
import { ConfigurationService } from "../../../../src/modules/system/configuration/application/service.js";
import {
	barrier,
	cleanup,
	completed,
	fixture,
	logger,
	setupTestLifecycle,
} from "../preparation/support/preparation-fixture.js";
import { required } from "./support.js";

setupTestLifecycle();
async function automatic(f: Awaited<ReturnType<typeof fixture>>) {
	const system = await ConfigurationService.load({
		ANISHELF_DATA_DIR: f.dataDir,
	});
	system.transcodeProfiles = f.profiles;
	await system.patchSettings({ autoPreparationEnabled: true });
	const worker = new AutomaticPreparationApplication({
		system,
		resources: f.library,
		inspection: f.inspection,
		preparation: f.application,
		repository: f.database.preparation,
		viewing: async (sources) =>
			required(f.database.playback.viewingStates).call(
				f.database.playback,
				sources,
			),
		logger,
	});
	worker.start();
	cleanup.push(() => worker.close());
	return { worker, system };
}
async function first(f: Awaited<ReturnType<typeof fixture>>) {
	await vi.waitFor(() =>
		expect(f.database.preparation.list().length).toBeGreaterThan(0),
	);
	return required(f.database.preparation.list()[0]);
}
test("startup processes old resources; deletion and cancellation are eligible for reconstruction", async () => {
	const f = await fixture();
	const { worker } = await automatic(f);
	const task = await first(f);
	await completed(f, task.id);
	expect(task.demand?.origin).toBe("automatic");
	await f.application.deleteArtifact(task.spec.executionPlanId);
	worker.wake();
	await vi.waitFor(() => expect(f.processing.start).toHaveBeenCalledTimes(2));
	await completed(f, task.id);
	expect(f.database.preparation.list()).toHaveLength(1);
});
test("settings disable cancels queued automatic tasks while running work finishes", async () => {
	const gate = barrier();
	const f = await fixture({ beforeOutput: async () => gate.promise });
	await writeFile(join(dirname(f.sourcePath), "second.mkv"), "source two");
	await f.library.startScan();
	await f.library.waitForCompletion();
	const { system } = await automatic(f);
	await vi.waitFor(() => expect(f.database.preparation.list()).toHaveLength(2));
	await vi.waitFor(() =>
		expect(
			f.database.preparation
				.list()
				.filter((t) => t.state.status === "processing"),
		).toHaveLength(1),
	);
	await system.patchSettings({ autoPreparationEnabled: false });
	await vi.waitFor(() =>
		expect(
			f.database.preparation
				.list()
				.filter((t) => t.state.status === "cancelled"),
		).toHaveLength(1),
	);
	expect(
		f.database.preparation
			.list()
			.filter((t) => t.state.status === "processing"),
	).toHaveLength(1);
	gate.resolve();
	await vi.waitFor(() =>
		expect(
			f.database.preparation.list().filter((t) => t.state.status === "ready"),
		).toHaveLength(1),
	);
});
test("restart retains extended execution plans, automatic provenance and completed copies", async () => {
	const f = await fixture();
	const { worker } = await automatic(f);
	const task = await first(f);
	await completed(f, task.id);
	await worker.close();
	await f.restart();
	const recovered = required(f.database.preparation.get(task.id));
	expect(recovered.demand?.origin).toBe("automatic");
	expect(recovered.spec.settings.plan.audioTracks).toHaveLength(1);
	expect(recovered.state.status).toBe("ready");
	expect(
		(await f.application.catalog(task.spec.source.fileId)).assets,
	).toHaveLength(1);
});
test("temporary failure persists backoff and does not immediately retry", async () => {
	const f = await fixture({
		beforeOutput: async () => {
			throw new Error("temporary");
		},
	});
	const { worker } = await automatic(f);
	const task = await first(f);
	await completed(f, task.id);
	worker.wake();
	await vi.waitFor(() =>
		expect(f.database.preparation.get(task.id)?.state.status).toBe("failed"),
	);
	await new Promise((resolve) => setTimeout(resolve, 100));
	worker.wake();
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(f.processing.start).toHaveBeenCalledTimes(1);
});
test("read-only viewing lookup classifies file progress without creating sessions", async () => {
	const f = await fixture();
	const input = await f.input();
	const source = (await f.library.sources.resolveSource(input.fileId)).identity;
	expect(
		required(f.database.playback.viewingStates).call(f.database.playback, [
			source,
		])[source.fileId],
	).toBe("unwatched");
	const session = await f.playback.open(source.fileId);
	await f.playback.save({
		token: session.token,
		sourceVersion: source.sourceVersion,
		generation: session.progress.generation,
		sequence: 1,
		positionMs: 1900,
		durationMs: 2000,
	});
	expect(
		required(f.database.playback.viewingStates).call(f.database.playback, [
			source,
		])[source.fileId],
	).toBe("completed");
	expect(
		required(f.database.playback.viewingStates).call(f.database.playback, [
			{ ...source, sourceVersion: "new" },
		])[source.fileId],
	).toBe("unwatched");
});

test("manual requests reuse and promote equivalent automatic work", async () => {
	const gate = barrier();
	const f = await fixture({ beforeOutput: async () => gate.promise });
	const { worker, system } = await automatic(f);
	const automaticTask = await first(f);
	await vi.waitFor(() => expect(f.processing.start).toHaveBeenCalledTimes(1));
	const manual = await f.preparation.create(await f.input());
	expect(manual.kind).toBe("task");
	if (manual.kind !== "task") throw new Error("Expected preparation task");
	expect(manual.task.id).toBe(automaticTask.id);
	expect(f.database.preparation.get(automaticTask.id)?.demand?.origin).toBe(
		"manual",
	);
	await system.patchSettings({ autoPreparationEnabled: false });
	await worker.close();
	gate.resolve();
	await completed(f, automaticTask.id);
	expect(f.processing.start).toHaveBeenCalledTimes(1);
});

test("automatic task retry is replanned on the server and needs no browser evidence", async () => {
	let fail = true;
	const f = await fixture({
		beforeOutput: async () => {
			if (fail) throw new Error("temporary");
		},
	});
	await automatic(f);
	const task = await first(f);
	await completed(f, task.id);
	fail = false;
	const response = await f.app.inject({
		method: "POST",
		url: `/api/preparations/${task.id}/retry`,
		headers: { host: "127.0.0.1:3000" },
		payload: {},
	});
	expect(response.statusCode).toBe(200);
	await completed(f, task.id);
	expect((await f.application.get(task.id)).task.state.status).toBe("ready");
});

test("queued automatic work retains its preset and encoding snapshots after catalog removal", async () => {
	const gate = barrier();
	const f = await fixture({ beforeOutput: async () => gate.promise });
	try {
		await writeFile(join(dirname(f.sourcePath), "second.mkv"), "source two");
		await f.library.startScan();
		await f.library.waitForCompletion();
		const { system, worker } = await automatic(f);
		await vi.waitFor(() =>
			expect(f.database.preparation.list()).toHaveLength(2),
		);
		const queued = required(
			f.database.preparation.list().find((t) => t.state.status === "queued"),
		);
		const snapshot = structuredClone(queued.spec.settings);
		expect(snapshot.automaticPreset?.id).toBe("builtin:web");
		system.transcodeProfiles = [];
		system.autoPreparationPresets = [];
		worker.wake();
		gate.resolve();
		expect((await completed(f, queued.id)).status).toBe("ready");
		expect(f.database.preparation.get(queued.id)?.spec.settings).toEqual(
			snapshot,
		);
	} finally {
		gate.resolve();
	}
});
