import { expect, test, vi } from "vitest";
import {
	DownloadContext,
	DownloadExecution,
} from "../../../../src/modules/acquisition/downloads/application/context.js";
import { DownloadTransfers } from "../../../../src/modules/acquisition/downloads/transfers/application.js";
import { TorrentError } from "../../../../src/modules/acquisition/torrent-clients/public.js";

import {
	fixture,
	key,
	logger,
	setupTestLifecycle,
} from "./support/acquisition-downloads-fixture.js";

setupTestLifecycle();

test("completed files become available only after confined refresh and Anime ingestion", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	await f.worker.tick();
	expect(f.resources.inspect).toHaveBeenCalledWith(
		"root",
		"Frieren [anilist-1]/Frieren - 03.mkv",
	);
	expect(f.resources.refresh).toHaveBeenCalled();
	expect(f.ingestion.ingest).toHaveBeenCalled();
	expect(f.worker.activity(key).items[0]).toMatchObject({
		state: "available",
		ingestion: "available",
	});
	expect((await f.worker.settings()).destination?.visibilityVerified).toBe(
		true,
	);
});

test("missing completed file is an import failure and retry imports without downloading again", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	f.resources.inspect.mockRejectedValueOnce(new Error("missing"));
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.ingestion).toBe("failed");
	expect(f.ingestion.ingest).not.toHaveBeenCalled();
	const item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!item) throw new Error();
	f.worker.retry(item.id, item.revision, "retry-import", "import");
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(f.worker.activity(key).items[0]?.state).toBe("available");
});

test("unsupported multi-video layouts and association conflicts remain reviewable", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	vi.mocked(f.client.files).mockResolvedValue([
		{ path: "01.mkv", sizeBytes: 50, selected: true, progress: 1 },
		{ path: "02.mkv", sizeBytes: 50, selected: true, progress: 1 },
	]);
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]).toMatchObject({
		ingestion: "review",
		error: "unsupported_file_layout",
	});
	expect(f.ingestion.ingest).not.toHaveBeenCalled();
});

test("an ingested resource leaves the worker and remains historical activity during later outages or removal", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	await f.worker.tick();
	const calls = vi.mocked(f.client.task).mock.calls.length;
	vi.mocked(f.client.task).mockRejectedValue(
		new TorrentError("unavailable", "read"),
	);
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]?.state).toBe("available");
	expect(vi.mocked(f.client.task).mock.calls).toHaveLength(calls);
	f.ingestion.available.mockResolvedValueOnce(false);
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]).toMatchObject({
		state: "available",
		ingestion: "available",
		error: null,
	});
	expect(f.ingestion.ingest).toHaveBeenCalledTimes(1);
});

test("completed downloads are excluded from all subsequent worker batches", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	await f.worker.tick();
	const original = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!original) throw new Error();
	for (let index = 0; index < 7; index++) {
		expect(
			f.db.acquisitionDownloads.reserve({
				...original,
				id: `available-${index}`,
				hash: `reserved-${index}`,
				episode: index + 100,
			}),
		).toBe(true);
	}
	const read = vi.spyOn(f.db.acquisitionDownloads, "workBatch");
	const first = f.worker.tick(),
		second = f.worker.tick();
	expect(first).toBe(second);
	await first;
	expect(f.ingestion.available).not.toHaveBeenCalled();
	expect(read).toHaveReturnedWith([]);
	expect(f.db.acquisitionDownloads.hasActive()).toBe(false);
});

test("transfer completion returns evidence without invoking resource verification or Anime ingestion", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	const item = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!item) throw new Error("Missing intent");
	const context = new DownloadContext({
		store: f.db.acquisitionDownloads,
		transport: f.reader,
		connectionGeneration: () => item.destination.connectionGeneration,
		withClient: async (_generation, operation) => operation(f.client),
		logger,
	});
	const authorize = vi.fn(async () => item.subscriptionRevision);
	const transfer = new DownloadTransfers(context, { authorize });
	const completed = await transfer.run(new DownloadExecution(context, item));
	expect(completed?.files).toHaveLength(1);
	expect(f.resources.inspect).not.toHaveBeenCalled();
	expect(f.resources.refresh).not.toHaveBeenCalled();
	expect(f.ingestion.ingest).not.toHaveBeenCalled();
	expect(authorize).not.toHaveBeenCalled();
	expect(await completed?.verify()).toBe(true);
	vi.mocked(f.client.files).mockResolvedValueOnce([]);
	expect(await completed?.verify()).toBe(false);
	expect(f.add).toHaveBeenCalledTimes(1);
});

test("account replacement during ingestion cannot acknowledge the old download as available", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	f.ingestion.ingest.mockImplementationOnce(async () => {
		f.changeAccount();
		return "available";
	});
	await f.worker.tick();
	expect(f.worker.activity(key).items[0]).toMatchObject({
		state: "bound",
		ingestion: "failed",
		error: "downloader_configuration_changed",
	});
	expect(f.db.acquisitionDownloads.destination()?.visibilityVerified).toBe(
		false,
	);
	expect(f.add).toHaveBeenCalledTimes(1);
});

test.each([
	"checking",
	"moving",
	"metadata",
	"error",
	"missing",
	"unknown",
] as const)(
	"a complete byte count in %s state never authorizes ingestion",
	async (state) => {
		const f = await fixture();
		await f.configure();
		await f.authorize();
		await f.worker.tick();
		f.complete();
		if (!f.state.task) throw new Error("Missing task");
		f.state.task.state = state;
		await f.worker.tick();
		expect(f.ingestion.ingest).not.toHaveBeenCalled();
		expect(f.resources.inspect).not.toHaveBeenCalled();
		expect(f.add).toHaveBeenCalledTimes(1);
	},
);

test.each(["owner", "state"] as const)(
	"ingestion rechecks %s after resource inspection",
	async (change) => {
		const f = await fixture();
		await f.configure();
		await f.authorize();
		await f.worker.tick();
		f.complete();
		f.resources.inspect.mockImplementationOnce(async () => {
			if (!f.state.task) throw new Error("Missing task");
			if (change === "owner") f.state.task.ownerKey = "another-intent";
			else f.state.task.state = "moving";
			return { sizeBytes: 100, sourceVersion: "v1" };
		});
		await f.worker.tick();
		expect(f.ingestion.ingest).not.toHaveBeenCalled();
		expect(f.worker.activity(key).items[0]).toMatchObject({
			ingestion: "failed",
			error: "download_changed",
		});
	},
);

test("a different engine's completed state imports only selected files", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	f.complete();
	if (!f.state.task) throw new Error("Missing task");
	f.state.task.state = "completed";
	vi.mocked(f.client.files).mockResolvedValue([
		{ path: "Frieren - 03.mkv", sizeBytes: 100, progress: 1, selected: true },
		{ path: "extra.mkv", sizeBytes: 100, progress: 0, selected: false },
	]);
	await f.worker.tick();
	expect(f.ingestion.ingest).toHaveBeenCalledTimes(1);
	expect(f.worker.activity(key).items[0]?.state).toBe("available");
});
